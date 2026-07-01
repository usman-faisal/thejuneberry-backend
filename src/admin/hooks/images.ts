import { HttpTypes } from '@medusajs/framework/types';
import { UseMutationOptions, useMutation } from '@tanstack/react-query';

import { sdk } from '../lib/sdk';

export const useAdminUploadImage = (
  options?: UseMutationOptions<
    HttpTypes.AdminFileListResponse,
    Error,
    HttpTypes.AdminUploadFile
  >,
) => {
  return useMutation<
    HttpTypes.AdminFileListResponse,
    Error,
    HttpTypes.AdminUploadFile
  >({
    mutationKey: ['admin-upload-image'],
    mutationFn: async (payload) => {
      return sdk.admin.upload.create(payload);
    },
    ...options,
  });
};
