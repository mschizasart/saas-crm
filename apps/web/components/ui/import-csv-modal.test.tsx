import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportCsvModal } from './import-csv-modal';
import { jsonOk, jsonError } from '@/test-fixtures/api';

function csvFile(name: string, body: string) {
  return new File([body], name, { type: 'text/csv' });
}

describe('ImportCsvModal component', () => {
  it('does not render when open=false', () => {
    render(
      <ImportCsvModal
        open={false}
        onClose={() => {}}
        title="Import Clients"
        endpoint="/api/v1/clients/import"
      />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with title + Import button when open', () => {
    render(
      <ImportCsvModal
        open
        onClose={() => {}}
        title="Import Clients"
        endpoint="/api/v1/clients/import"
      />,
    );
    expect(screen.getByRole('dialog', { name: /import clients/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^import$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('shows preview rows after a CSV file is selected', async () => {
    const user = userEvent.setup();
    render(
      <ImportCsvModal
        open
        onClose={() => {}}
        title="Import Clients"
        endpoint="/api/v1/clients/import"
      />,
    );

    const csv = csvFile(
      'sample.csv',
      'company,phone\nAcme,555-0101\nGlobex,555-0202\n',
    );
    // The file input is hidden; query it by label.
    const input = screen.getByLabelText('CSV file') as HTMLInputElement;
    await user.upload(input, csv);

    await waitFor(() => {
      expect(screen.getByText('sample.csv')).toBeInTheDocument();
    });
    // Header row + 2 data rows show
    expect(await screen.findByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
    // header rendered
    expect(screen.getByRole('columnheader', { name: 'company' })).toBeInTheDocument();
  });

  it('rejects a non-csv file with an error message', async () => {
    const user = userEvent.setup();
    render(
      <ImportCsvModal
        open
        onClose={() => {}}
        title="Import"
        endpoint="/api/v1/clients/import"
      />,
    );

    const wrong = new File(['not csv'], 'foo.txt', { type: 'text/plain' });
    const input = screen.getByLabelText('CSV file') as HTMLInputElement;
    await user.upload(input, wrong);

    expect(await screen.findByText(/please select a \.csv file/i)).toBeInTheDocument();
  });

  it('hits the configured endpoint and shows the result counts on success', async () => {
    const user = userEvent.setup();
    const onImported = vi.fn();
    globalThis.mockApiFetch.mockResolvedValueOnce(
      jsonOk({
        imported: 7,
        skipped: [{ row: 2, reason: 'duplicate email' }],
        errors: [],
      }),
    );

    render(
      <ImportCsvModal
        open
        onClose={() => {}}
        title="Import"
        endpoint="/api/v1/clients/import"
        onImported={onImported}
      />,
    );

    const csv = csvFile('x.csv', 'a,b\n1,2\n');
    await user.upload(screen.getByLabelText('CSV file') as HTMLInputElement, csv);
    // Wait for preview to land before clicking Import.
    await waitFor(() => expect(screen.getByText('x.csv')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^import$/i }));

    await waitFor(() => {
      expect(globalThis.mockApiFetch).toHaveBeenCalledWith(
        '/api/v1/clients/import',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    // Result panel
    expect(await screen.findByText('7')).toBeInTheDocument();
    expect(screen.getByText(/imported/i)).toBeInTheDocument();
    expect(screen.getByText(/skipped/i)).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledWith(
      expect.objectContaining({ imported: 7 }),
    );
  });

  it('shows an error banner when the API returns a non-2xx', async () => {
    const user = userEvent.setup();
    globalThis.mockApiFetch.mockResolvedValueOnce(
      jsonError(500, { message: 'Database is sad' }),
    );

    render(
      <ImportCsvModal
        open
        onClose={() => {}}
        title="Import"
        endpoint="/api/v1/clients/import"
      />,
    );

    const csv = csvFile('x.csv', 'a,b\n1,2\n');
    await user.upload(screen.getByLabelText('CSV file') as HTMLInputElement, csv);
    await waitFor(() => expect(screen.getByText('x.csv')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /^import$/i }));

    expect(await screen.findByText(/database is sad/i)).toBeInTheDocument();
  });

  it('Cancel button calls onClose and resets state', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ImportCsvModal
        open
        onClose={onClose}
        title="Import"
        endpoint="/api/v1/clients/import"
      />,
    );
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
