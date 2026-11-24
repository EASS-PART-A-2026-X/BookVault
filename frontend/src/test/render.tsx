import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { AppRoutes } from '../App';

/** Exposes the current URL so tests can assert on query-string state. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

export function renderApp(url = '/') {
  const user = userEvent.setup();
  const utils = render(
    <MemoryRouter initialEntries={[url]}>
      <AppRoutes />
      <LocationProbe />
    </MemoryRouter>,
  );
  return { user, ...utils };
}
