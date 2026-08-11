import { buildCategoryPath } from './legacyCategoryPath';
import { deterministicId } from './legacyDeterministicId';
import type {
  LegacyCategoryNode,
  LegacyMigrationManifest,
  LegacyOpeningAdjustment
} from './types';
import { parseLegacyAssetTrackerData } from './types';

function isLeafCategory(node: LegacyCategoryNode): boolean {
  return !node.children || Object.keys(node.children).length === 0;
}

export function buildLegacyMigrationManifest(
  input: unknown
): LegacyMigrationManifest {
  const parsed = parseLegacyAssetTrackerData(input);
  const initialAssetMap =
    parsed.initialAssets && !Array.isArray(parsed.initialAssets) ? parsed.initialAssets : undefined;
  const categoryPathToId: Record<string, string> = {};
  const openingAdjustments: LegacyOpeningAdjustment[] = [];

  function walk(
    node: LegacyCategoryNode,
    parentPath: string | null,
    parentRawPath: string | null
  ): void {
    const path = buildCategoryPath(parentPath, node.name);
    const rawPath = parentRawPath ? `${parentRawPath}/${node.name}` : node.name;
    categoryPathToId[path] = deterministicId('cat', path);

    if (isLeafCategory(node)) {
      const initialAmount = initialAssetMap?.[path] ?? initialAssetMap?.[rawPath];
      const fallbackAmount = typeof node.balance === 'number' ? node.balance : undefined;
      const amount = initialAmount ?? fallbackAmount;

      if (typeof amount === 'number') {
        openingAdjustments.push({ categoryPath: path, amount });
      }
    }

    if (node.children) {
      Object.values(node.children).forEach((child) => walk(child, path, rawPath));
    }
  }

  Object.values(parsed.categories).forEach((category) => walk(category, null, null));

  return {
    categoryPathToId,
    openingAdjustments,
    report: {
      totalCategories: Object.keys(categoryPathToId).length,
      totalTransactions: parsed.transactions.length,
      totalOpeningAdjustments: openingAdjustments.length
    }
  };
}
