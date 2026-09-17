import 'dotenv/config';
import { DataSource } from 'typeorm';

/** Used by the TypeORM CLI for generating and running migrations. */
export default new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/db/migrations/*.ts'],
  synchronize: false,
});
