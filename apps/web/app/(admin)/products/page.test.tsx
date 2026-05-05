import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProductsPage from './page';
import { jsonOk } from '@/test-fixtures/api';

const PRODUCTS_RESPONSE = {
  data: [
    {
      id: 'pr1',
      name: 'Hosting plan',
      description: 'Annual hosting',
      sku: 'HST-1',
      unitPrice: 99,
      costPrice: 30,
      taxRate: 20,
      unit: 'year',
      stockQuantity: 100,
      lowStockAlert: 5,
      trackInventory: false,
      active: true,
    },
    {
      id: 'pr2',
      name: 'Widget',
      description: null,
      sku: 'WDG-1',
      unitPrice: 9.99,
      costPrice: 2,
      taxRate: 20,
      unit: 'piece',
      stockQuantity: 3,
      lowStockAlert: 5,
      trackInventory: true,
      active: true,
    },
  ],
  total: 2,
  page: 1,
  limit: 20,
  totalPages: 1,
};

const LOW_STOCK_RESPONSE = [PRODUCTS_RESPONSE.data[1]];

function setupApiMock(list = PRODUCTS_RESPONSE, low = LOW_STOCK_RESPONSE) {
  globalThis.mockApiFetch.mockImplementation(async (url: string) => {
    if (url.includes('/products/low-stock')) return jsonOk(low);
    if (url.startsWith('/api/v1/products')) return jsonOk(list);
    return jsonOk({});
  });
}

describe('Products page', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    setupApiMock();
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('renders the Products heading', async () => {
    render(<ProductsPage />);
    expect(
      await screen.findByRole('heading', { name: /^products$/i }),
    ).toBeInTheDocument();
  });

  it('renders the All / Low stock tabs and the search input', async () => {
    render(<ProductsPage />);
    expect(await screen.findByRole('button', { name: /all products/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /low stock/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/search products/i)).toBeInTheDocument();
  });

  it('renders rows for each product', async () => {
    render(<ProductsPage />);
    expect(await screen.findByText('Hosting plan')).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
  });

  it('shows a LOW badge on products at or below their low-stock alert', async () => {
    render(<ProductsPage />);
    await screen.findByText('Widget');
    expect(screen.getByText('LOW')).toBeInTheDocument();
  });

  it('switches to the low-stock tab when clicked', async () => {
    const user = userEvent.setup();
    render(<ProductsPage />);
    await screen.findByText('Hosting plan');
    await user.click(screen.getByRole('button', { name: /low stock/i }));
    // Hosting plan has trackInventory=false → not in low-stock fetch result
    await screen.findByText('Widget');
    expect(screen.queryByText('Hosting plan')).not.toBeInTheDocument();
  });

  it('does not surface React render errors', async () => {
    render(<ProductsPage />);
    await screen.findByText('Hosting plan');
    expect(consoleError).not.toHaveBeenCalled();
  });
});
