import { z } from 'zod';

// These are the collection tabs that older storefronts displayed before any
// custom categories. Stable keys keep renamed categories in their saved place.
const builtins = [
  { key: 'all', name: 'All', slug: '' },
  { key: 'casual', name: 'Casual', slug: 'casual' },
  { key: 'sports', name: 'Sports', slug: 'sports' },
  { key: 'fashion', name: 'Fashion', slug: 'fashion' },
  { key: 'best-sellers', name: 'Best Sellers', slug: 'best-sellers' },
  { key: 'hot-deals', name: 'Hot Deals', slug: 'hot-deals' }
] as const;

type Category = { id: string; name: string; slug: string; active: boolean };
export type HomepageSection = {
  key: string;
  name: string;
  slug: string;
  visible: boolean;
  type: 'builtin' | 'category';
  categoryActive: boolean;
};

const savedSectionSchema = z.object({
  key: z.string().min(1).max(160),
  visible: z.boolean()
}).strict();
export const homepageLayoutSchema = z.object({
  sections: z.array(savedSectionSchema).max(2000)
}).strict().superRefine(({ sections }, context) => {
  const keys = new Set<string>();
  sections.forEach((section, index) => {
    if (keys.has(section.key)) context.addIssue({ code: 'custom', path: ['sections', index, 'key'], message: 'لا يمكن تكرار القسم في ترتيب الرئيسية.' });
    keys.add(section.key);
  });
});

export function resolvedHomepageSections(value: unknown, categories: Category[]): HomepageSection[] {
  const available: HomepageSection[] = builtins.map(section => ({
    ...section,
    visible: true,
    type: 'builtin',
    categoryActive: !section.slug || ['best-sellers', 'hot-deals'].includes(section.slug) || categories.find(category => category.slug === section.slug)?.active !== false
  }));
  const slugs = new Set(available.map(section => section.slug));
  for (const category of categories) {
    if (slugs.has(category.slug)) continue;
    slugs.add(category.slug);
    available.push({ key: `category:${category.id}`, name: category.name, slug: category.slug, visible: true, type: 'category', categoryActive: category.active });
  }

  const byKey = new Map(available.map(section => [section.key, section]));
  const sections: HomepageSection[] = [];
  // Resolve old or partially saved settings without writing defaults to the DB.
  for (const entry of Array.isArray(value) ? value : []) {
    const parsed = savedSectionSchema.safeParse(entry);
    if (!parsed.success) continue;
    const section = byKey.get(parsed.data.key);
    if (!section) continue;
    sections.push({ ...section, visible: parsed.data.visible });
    byKey.delete(section.key);
  }
  for (const section of available) {
    if (byKey.has(section.key)) sections.push(section);
  }
  return sections;
}
