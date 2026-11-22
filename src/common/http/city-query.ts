import { invalidQuery } from './problem-details';

export function parseCity(value: unknown): string {
  if (typeof value === 'string') {
    const city = value.trim().toLowerCase();
    if (city.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(city)) return city;
  }
  throw invalidQuery('Provide city once as a slug of up to 64 letters, digits, and hyphens.');
}
