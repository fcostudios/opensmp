import {
  createPoolRepository,
  type PoolRepository,
} from "./pool-repository";

let productionRepository: PoolRepository | undefined;

export function getPoolRepository(): PoolRepository {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  productionRepository ??= createPoolRepository(connectionString);
  return productionRepository;
}
