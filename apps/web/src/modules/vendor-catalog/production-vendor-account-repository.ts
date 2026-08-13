import {
  createVendorAccountRepository,
  type VendorAccountRepository,
} from "./vendor-account-repository";

let productionRepository: VendorAccountRepository | undefined;

export function getVendorAccountRepository(): VendorAccountRepository {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  productionRepository ??= createVendorAccountRepository(connectionString);
  return productionRepository;
}
