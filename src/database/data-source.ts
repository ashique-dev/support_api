import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config();

// This file is used ONLY by the TypeORM CLI for migration commands.
// The app itself uses the TypeOrmModule.forRootAsync() in app.module.ts.
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT, 10) || 5432,
  username: process.env.DB_USER || 'support_user',
  password: process.env.DB_PASSWORD || 'support_pass',
  database: process.env.DB_NAME || 'support_db',
  entities: [join(__dirname, '../**/*.entity{.ts,.js}')],
  migrations: [join(__dirname, 'migrations/**/*{.ts,.js}')],
  synchronize: false,
  logging: true,
});
