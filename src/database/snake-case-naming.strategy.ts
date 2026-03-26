import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

function snakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, (letter) => `_${letter.toLowerCase()}`)
    .replace(/^_/, '');
}

export class SnakeCaseNamingStrategy
  extends DefaultNamingStrategy
  implements NamingStrategyInterface
{
  columnName(propertyName: string, customName: string): string {
    return customName || snakeCase(propertyName);
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(`${relationName}_${referencedColumnName}`);
  }

  joinTableColumnName(
    tableName: string,
    propertyName: string,
    columnName?: string,
  ): string {
    return snakeCase(`${tableName}_${columnName || propertyName}`);
  }
}
