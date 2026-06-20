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
  createTaxRegionsWorkflow,
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

  // Resolve module services for idempotency checks
  const fulfillmentModuleService: IFulfillmentModuleService = container.resolve(
    Modules.FULFILLMENT,
  );
  const salesChannelModuleService: ISalesChannelModuleService =
    container.resolve(Modules.SALES_CHANNEL);
  const storeModuleService: IStoreModuleService = container.resolve(
    Modules.STORE,
  );
  const regionModuleService: IRegionModuleService = container.resolve(
    Modules.REGION,
  );
  const productModuleService: IProductModuleService = container.resolve(
    Modules.PRODUCT,
  );

  logger.info("Starting The Juneberry minimal seed...");

  // 1. SETUP SALES CHANNEL
  let [defaultSalesChannel] = await salesChannelModuleService.listSalesChannels(
    {
      name: "The Juneberry",
    },
  );

  if (!defaultSalesChannel) {
    const { result: salesChannelResult } = await createSalesChannelsWorkflow(
      container,
    ).run({
      input: {
        salesChannelsData: [{ name: "The Juneberry" }],
      },
    });
    defaultSalesChannel = salesChannelResult[0];
  }

  // 2. SETUP REGION & STORE CONFIG
  logger.info("Configuring Pakistan region and PKR currency...");
  let [region] = await regionModuleService.listRegions({ name: "Pakistan" });

  if (!region) {
    const { result: regionResult } = await createRegionsWorkflow(container).run(
      {
        input: {
          regions: [
            {
              name: "Pakistan",
              currency_code: "pkr",
              countries: ["pk"],
              payment_providers: ["pp_system_default"], // COD default
            },
          ],
        },
      },
    );
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

  // 3. SETUP TAX REGIONS
  logger.info("Setting up tax regions...");
  try {
    await createTaxRegionsWorkflow(container).run({
      input: [{ country_code: "pk" }],
    });
  } catch (e) {
    logger.info("Tax region for PK likely already exists, skipping...");
  }

  // 4. SETUP INVENTORY & FULFILLMENT
  logger.info("Configuring fulfillment and shipping...");
  const { result: stockLocationResult } = await createStockLocationsWorkflow(
    container,
  ).run({
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
  const stockLocation = stockLocationResult[0];

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

  const { result: shippingProfileResult } =
    await createShippingProfilesWorkflow(container).run({
      input: {
        data: [{ name: "Default Standard", type: "default" }],
      },
    });
  const shippingProfile = shippingProfileResult[0];

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
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
          { attribute: "enabled_in_store", value: '"true"', operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      },
    ],
  });

  // 5. SETUP API KEYS
  logger.info("Configuring API Keys...");
  const { result: publishableApiKeyResult } = await createApiKeysWorkflow(
    container,
  ).run({
    input: {
      api_keys: [{ title: "Webshop", type: "publishable", created_by: "seed" }],
    },
  });

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: publishableApiKeyResult[0].id,
      add: [defaultSalesChannel.id],
    },
  });

  // 6. SETUP CATEGORIES & COLLECTIONS
  logger.info("Seeding Collections and Categories...");

  const existingCategories = await productModuleService.listProductCategories();
  let categories = existingCategories;

  if (categories.length === 0) {
    const { result } = await createProductCategoriesWorkflow(container).run({
      input: {
        product_categories: [
          { name: "Linen", is_active: true },
          { name: "Tissue", is_active: true },
          { name: "Taftan", is_active: true },
          { name: "Chiffon", is_active: true },
        ],
      },
    });
    categories = result;
  }

  const existingCollections =
    await productModuleService.listProductCollections();
  let collections = existingCollections;

  if (collections.length === 0) {
    const { result } = await createCollectionsWorkflow(container).run({
      input: {
        collections: [
          { title: "Winter Collection", handle: "winter-collection" },
          { title: "Summer Collection", handle: "summer-collection" },
        ],
      },
    });
    collections = result;
  }

  // 7. SETUP PRODUCTS
  logger.info("Seeding Products...");
  const existingProducts = await productModuleService.listProducts();

  if (existingProducts.length === 0) {
    const sizes = ["S", "M", "L", "XL"];

    // Helper to generate variants mapped to sizes
    const generateSizeVariants = (
      baseTitle: string,
      baseSku: string,
      priceAmount: number,
    ) => {
      return sizes.map((size) => ({
        title: size,
        sku: `${baseSku}-${size}`,
        options: { Size: size },
        manage_inventory: false,
        prices: [{ amount: priceAmount, currency_code: "pkr" }],
      }));
    };

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
            collection_id: collections.find(
              (c) => c.title === "Summer Collection",
            )?.id,
            status: ProductStatus.PUBLISHED,
            options: [{ title: "Size", values: sizes }],
            variants: generateSizeVariants(
              "Sapphire Breeze",
              "SAPPHIRE-LAWN",
              3500,
            ),
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
            collection_id: collections.find(
              (c) => c.title === "Winter Collection",
            )?.id,
            status: ProductStatus.PUBLISHED,
            options: [{ title: "Size", values: sizes }],
            variants: generateSizeVariants(
              "Midnight Velvet",
              "MIDNIGHT-TAFTAN",
              6000,
            ),
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
            collection_id: collections.find(
              (c) => c.title === "Summer Collection",
            )?.id,
            status: ProductStatus.PUBLISHED,
            options: [{ title: "Size", values: sizes }],
            variants: generateSizeVariants(
              "Gulbahar Tissue",
              "GULBAHAR-TISSUE",
              4800,
            ),
            sales_channels: [{ id: defaultSalesChannel.id }],
          },
        ],
      },
    });
  }

  logger.info("Successfully finished seeding The Juneberry demo data!");
}
