import {
  createApiKeysWorkflow,
  createCollectionsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  ExecArgs,
  IFulfillmentModuleService,
  ISalesChannelModuleService,
  IStoreModuleService,
  IRegionModuleService,
  IProductModuleService,
} from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";

export default async function seedDemoData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const remoteLink = container.resolve(ContainerRegistrationKeys.LINK);

  // Resolve all module services
  const fulfillmentModuleService: IFulfillmentModuleService = container.resolve(
    Modules.FULFILLMENT
  );
  const salesChannelModuleService: ISalesChannelModuleService =
    container.resolve(Modules.SALES_CHANNEL);
  const storeModuleService: IStoreModuleService = container.resolve(
    Modules.STORE
  );
  const regionModuleService: IRegionModuleService = container.resolve(
    Modules.REGION
  );
  const productModuleService: IProductModuleService = container.resolve(
    Modules.PRODUCT
  );
  const apiKeyModuleService = container.resolve(Modules.API_KEY);
  const stockLocationModuleService = container.resolve(Modules.STOCK_LOCATION);

  logger.info("Starting The Juneberry seed...");

  // 1. SALES CHANNEL — reuse existing default, rename if needed
  logger.info("Setting up sales channel...");
  let [defaultSalesChannel] =
    await salesChannelModuleService.listSalesChannels();
  if (!defaultSalesChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [{ name: "The Juneberry" }],
      },
    });
    defaultSalesChannel = result[0];
  } else if (defaultSalesChannel.name !== "The Juneberry") {
    await salesChannelModuleService.updateSalesChannels(
      defaultSalesChannel.id,
      { name: "The Juneberry" }
    );
  }

  // 2. REGION & STORE CONFIG
  logger.info("Configuring Pakistan region and PKR currency...");
  let [region] = await regionModuleService.listRegions({ name: "Pakistan" });
  if (!region) {
    const { result: regionResult } = await createRegionsWorkflow(
      container
    ).run({
      input: {
        regions: [
          {
            name: "Pakistan",
            currency_code: "pkr",
            countries: ["pk"],
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    });
    region = regionResult[0];
  }

  const [store] = await storeModuleService.listStores();
  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        supported_currencies: [{ currency_code: "pkr", is_default: true }],
        default_sales_channel_id: defaultSalesChannel.id,
        default_region_id: region.id,
      },
    },
  });

  // 3. STOCK LOCATION — idempotent
  logger.info("Setting up stock location...");
  let stockLocation;
  const existingLocations =
    await stockLocationModuleService.listStockLocations({
      name: "Main Warehouse",
    });
  if (existingLocations.length === 0) {
    const { result: stockLocationResult } =
      await createStockLocationsWorkflow(container).run({
        input: {
          locations: [
            {
              name: "Main Warehouse",
              address: {
                city: "Karachi",
                country_code: "PK",
                address_1: "Shah Faisal Town",
              },
            },
          ],
        },
      });
    stockLocation = stockLocationResult[0];

    await linkSalesChannelsToStockLocationWorkflow(container).run({
      input: {
        id: stockLocation.id,
        add: [defaultSalesChannel.id],
      },
    });

    await remoteLink.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
    });
  } else {
    stockLocation = existingLocations[0];
  }

  // 4. SHIPPING PROFILE — idempotent
  logger.info("Setting up shipping profile...");
  let shippingProfile;
  const existingProfiles =
    await fulfillmentModuleService.listShippingProfiles({ type: "default" });
  if (existingProfiles.length === 0) {
    const { result: shippingProfileResult } =
      await createShippingProfilesWorkflow(container).run({
        input: {
          data: [{ name: "Default Standard", type: "default" }],
        },
      });
    shippingProfile = shippingProfileResult[0];
  } else {
    shippingProfile = existingProfiles[0];
  }

  // 5. FULFILLMENT SET & SHIPPING OPTION — idempotent
  logger.info("Setting up fulfillment set and shipping options...");
  const existingFulfillmentSets =
    await fulfillmentModuleService.listFulfillmentSets({
      name: "Pakistan Delivery",
    });

  if (existingFulfillmentSets.length === 0) {
    const fulfillmentSet =
      await fulfillmentModuleService.createFulfillmentSets({
        name: "Pakistan Delivery",
        type: "shipping",
        service_zones: [
          {
            name: "Pakistan",
            geo_zones: [{ country_code: "pk", type: "country" }],
          },
        ],
      });

    await remoteLink.create({
      [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
      [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
    });

    await createShippingOptionsWorkflow(container).run({
      input: [
        {
          name: "Standard Flat Rate",
          price_type: "flat",
          provider_id: "manual_manual",
          service_zone_id: fulfillmentSet.service_zones[0].id,
          shipping_profile_id: shippingProfile.id,
          type: {
            label: "Standard",
            description: "Delivery across Pakistan in 3-5 working days.",
            code: "standard",
          },
          prices: [
            { currency_code: "pkr", amount: 200 },
            { region_id: region.id, amount: 200 },
          ],
          rules: [
            {
              attribute: "enabled_in_store",
              value: '"true"',
              operator: "eq",
            },
            { attribute: "is_return", value: "false", operator: "eq" },
          ],
        },
      ],
    });
  }

  // 6. API KEY — reuse existing, don't create duplicates
  logger.info("Setting up API key...");
  const existingKeys = await apiKeyModuleService.listApiKeys();
  if (existingKeys.length === 0) {
    const { result: publishableApiKeyResult } =
      await createApiKeysWorkflow(container).run({
        input: {
          api_keys: [
            { title: "Webshop", type: "publishable", created_by: "seed" },
          ],
        },
      });
    await linkSalesChannelsToApiKeyWorkflow(container).run({
      input: {
        id: publishableApiKeyResult[0].id,
        add: [defaultSalesChannel.id],
      },
    });
  } else {
    // Link the existing key to the sales channel if not already linked
    try {
      await linkSalesChannelsToApiKeyWorkflow(container).run({
        input: {
          id: existingKeys[0].id,
          add: [defaultSalesChannel.id],
        },
      });
    } catch (e) {
      logger.info("API key already linked to sales channel, skipping...");
    }
  }

  // 7. CATEGORIES — idempotent
  logger.info("Seeding categories...");
  const existingCategories =
    await productModuleService.listProductCategories();
  if (existingCategories.length === 0) {
    await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: [
          { name: "Linen", is_active: true },
          { name: "Tissue", is_active: true },
          { name: "Taftan", is_active: true },
          { name: "Chiffon", is_active: true },
        ],
      },
    });
  }

  // Refetch categories after potential creation
  const categories = await productModuleService.listProductCategories();

  // 8. COLLECTIONS — idempotent
  logger.info("Seeding collections...");
  const existingCollections =
    await productModuleService.listProductCollections();

  let collections = existingCollections;
  if (existingCollections.length === 0) {
    const { result } = await createCollectionsWorkflow(container).run({
      input: {
        collections: [
          { title: "New Arrivals", handle: "new-arrivals" },
          { title: "Winter Collection", handle: "winter-collection" },
          { title: "Summer Collection", handle: "summer-collection" },
        ],
      },
    });
    collections = result;
  }

  // 9. PRODUCTS — idempotent
  logger.info("Seeding products...");
  const existingProducts = await productModuleService.listProducts();

  if (existingProducts.length === 0) {
    const sizes = ["S", "M", "L", "XL"];

    const generateSizeVariants = (baseSku: string, priceAmount: number) => {
      return sizes.map((size) => ({
        title: size,
        sku: `${baseSku}-${size}`,
        options: { Size: size },
        manage_inventory: false,
        prices: [{ amount: priceAmount, currency_code: "pkr" }],
      }));
    };

    const newArrivalsCollection = collections.find(
      (c) => c.handle === "new-arrivals"
    );
    const winterCollection = collections.find(
      (c) => c.handle === "winter-collection"
    );
    const summerCollection = collections.find(
      (c) => c.handle === "summer-collection"
    );

    await createProductsWorkflow(container).run({
      input: {
        products: [
          {
            title: "Sapphire Breeze Lawn Kurta",
            handle: "sapphire-breeze-lawn-kurta",
            description:
              "A breathable, everyday lawn kurta featuring delicate threadwork and a relaxed fit. Perfect for battling the summer heat with elegance.",
            category_ids: [
              categories.find((c) => c.name === "Linen")?.id ||
                categories[0].id,
            ],
            collection_id: newArrivalsCollection?.id || summerCollection?.id,
            status: ProductStatus.PUBLISHED,
            options: [{ title: "Size", values: sizes }],
            variants: generateSizeVariants("SAPPHIRE-LAWN", 3500),
            sales_channels: [{ id: defaultSalesChannel.id }],
          },
          {
            title: "Midnight Velvet Taftan Dress",
            handle: "midnight-velvet-taftan-dress",
            description:
              "Rich, luxurious Taftan fabric tailored into a sleek winter dress. Adorned with minimal zari work for festive winter evenings.",
            category_ids: [
              categories.find((c) => c.name === "Taftan")?.id ||
                categories[0].id,
            ],
            collection_id: newArrivalsCollection?.id || winterCollection?.id,
            status: ProductStatus.PUBLISHED,
            options: [{ title: "Size", values: sizes }],
            variants: generateSizeVariants("MIDNIGHT-TAFTAN", 6000),
            sales_channels: [{ id: defaultSalesChannel.id }],
          },
          {
            title: "Gulbahar Tissue Two-Piece",
            handle: "gulbahar-tissue-two-piece",
            description:
              "A vibrant two-piece suit crafted from premium lightweight tissue fabric. Features floral digital prints paired with a matching dupatta.",
            category_ids: [
              categories.find((c) => c.name === "Tissue")?.id ||
                categories[0].id,
            ],
            collection_id: summerCollection?.id,
            status: ProductStatus.PUBLISHED,
            options: [{ title: "Size", values: sizes }],
            variants: generateSizeVariants("GULBAHAR-TISSUE", 4800),
            sales_channels: [{ id: defaultSalesChannel.id }],
          },
        ],
      },
    });
  }

  logger.info("The Juneberry seed completed successfully!");
}