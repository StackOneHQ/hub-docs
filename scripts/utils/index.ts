/**
 * Convert string to kebab-case for use in filenames.
 * Handles camelCase, spaces, underscores, and dots.
 *
 * @example
 * toKebabCase("OAuth 2.0") // "oauth-2.0"
 * toKebabCase("API Key")   // "api-key"
 */
export function toKebabCase(str: string): string {
    return str
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}
