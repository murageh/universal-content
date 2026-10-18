/**
 * src/mock-db.ts
 *
 * Agnostic mock database simulating host application database entities
 * (e.g. Products, Catalog items, Services) alongside core platform pages.
 */

export interface ProductRecord {
  id: string;
  slug: string;
  name: string;
  category: string;
  price: number;
  currency: string;
  inStock: boolean;
  isPubliclySearchable: boolean;
  description: string;
  rating: number;
  reviewCount: number;
  featuredImage: string;
  createdAt: Date;
}

export const MOCK_PRODUCTS: ProductRecord[] = [
  {
    id: 'prod_001',
    slug: 'wireless-noise-canceling-headphones',
    name: 'AcousticPro Wireless Noise-Canceling Headphones',
    category: 'Audio',
    price: 299,
    currency: 'USD',
    inStock: true,
    isPubliclySearchable: true,
    description: 'Studio-grade spatial audio, 40-hour battery life, and adaptive active noise cancellation.',
    rating: 4.9,
    reviewCount: 128,
    featuredImage: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=800&q=80',
    createdAt: new Date('2025-01-15T08:00:00Z'),
  },
  {
    id: 'prod_002',
    slug: 'ergonomic-mechanical-keyboard',
    name: 'ErgoMech Split Mechanical Keyboard',
    category: 'Peripherals',
    price: 189,
    currency: 'USD',
    inStock: true,
    isPubliclySearchable: true,
    description: 'Hot-swappable custom tactile switches, programmable OLED screens, and ortholinear layout.',
    rating: 4.8,
    reviewCount: 94,
    featuredImage: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=800&q=80',
    createdAt: new Date('2025-03-20T10:30:00Z'),
  },
  {
    id: 'prod_003',
    slug: 'ultrawide-curved-gaming-monitor',
    name: 'PanoraView 34-inch Curved UltraWide Monitor',
    category: 'Displays',
    price: 649,
    currency: 'USD',
    inStock: true,
    isPubliclySearchable: true,
    description: '165Hz refresh rate, 1ms response time, HDR600 color precision for creators and developers.',
    rating: 5.0,
    reviewCount: 62,
    featuredImage: 'https://images.unsplash.com/photo-1527443224154-c4a3942d3acf?w=800&q=80',
    createdAt: new Date('2025-06-10T14:15:00Z'),
  },
  {
    id: 'prod_004',
    slug: 'developer-standing-desk',
    name: 'ApexLift Solid Walnut Dual-Motor Standing Desk',
    category: 'Workspace',
    price: 499,
    currency: 'USD',
    inStock: true,
    isPubliclySearchable: true,
    description: 'Triple-stage telescoping legs, digital memory keypad, and integrated cable management routing.',
    rating: 4.7,
    reviewCount: 45,
    featuredImage: 'https://images.unsplash.com/photo-1595515106969-1ce29566ff1c?w=800&q=80',
    createdAt: new Date('2025-09-01T11:00:00Z'),
  },
];

export interface QueryOptions {
  where?: { inStock?: boolean; isPubliclySearchable?: boolean };
  select?: { slug?: boolean };
  orderBy?: { createdAt?: 'asc' | 'desc' };
}

export class MockDatabase {
  product = {
    findMany: async (query?: QueryOptions) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return MOCK_PRODUCTS.filter((p) => {
        if (query?.where?.inStock !== undefined && p.inStock !== query.where.inStock) return false;
        if (query?.where?.isPubliclySearchable !== undefined && p.isPubliclySearchable !== query.where.isPubliclySearchable) return false;
        return true;
      }).map((p) => ({
        slug: p.slug,
      }));
    },
    findUnique: async ({ where }: { where: { slug: string } }) => {
      return MOCK_PRODUCTS.find((p) => p.slug === where.slug) ?? MOCK_PRODUCTS[0];
    },
  };

  // Backwards compatibility for existing routes/authPrisma decorator
  shop = {
    findMany: async () => {
      const prods = await this.product.findMany();
      return prods.map((p) => ({ slug: p.slug, customDomain: null }));
    },
    findUnique: async ({ where }: { where: { slug: string } }) => {
      const p = await this.product.findUnique({ where });
      if (!p) return null;
      return {
        id: p.id,
        slug: p.slug,
        name: p.name,
        customDomain: null,
        description: p.description,
        address: 'Nairobi, Kenya',
        city: 'Nairobi',
        telephone: '+254 700 000 000',
        rating: p.rating,
        featuredImage: p.featuredImage,
      };
    },
  };
}

export { MockDatabase as MockAuthPrisma };

declare module 'fastify' {
  interface FastifyInstance {
    db: MockDatabase;
    authPrisma: MockDatabase;
  }
}
