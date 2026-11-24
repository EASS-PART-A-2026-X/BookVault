import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { expect } from 'vitest';
import { AppRoutes } from '../App';

/** Exposes the current URL so tests can assert on query-string state. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

/**
 * Render the whole app at `url` and wait until the "who's logged in" check is done
 * (logged in as "reader" by default, see mockApiFactory).
 */
export async function renderApp(url = '/') {
  const user = userEvent.setup();
  const utils = render(
    <MemoryRouter initialEntries={[url]}>
      <AppRoutes />
      <LocationProbe />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.queryByText('Checking your session…')).not.toBeInTheDocument());
  return { user, ...utils };
}
