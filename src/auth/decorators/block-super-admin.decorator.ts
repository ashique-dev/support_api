import { SetMetadata } from '@nestjs/common';

export const BLOCK_SUPER_ADMIN_KEY = 'blockSuperAdmin';
export const BlockSuperAdmin = () => SetMetadata(BLOCK_SUPER_ADMIN_KEY, true);