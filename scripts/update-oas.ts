/**
 * Regenerates the Legacy Unified APIs api-reference pages from the live OpenAPI specs.
 *
 * Ported from the docs repo's scripts/update-oas.ts when the Legacy Unified APIs moved
 * here. The only behavioural difference: docs maps the `stackone` category onto a
 * `platform/` directory, and that category stayed in docs, so the mapping is gone.
 * Keep the two scripts in step when either is fixed.
 */
import fs from 'node:fs';
import path from 'node:path';
import axios from 'axios';
import { CATEGORIES, type Category } from './config';
import { toKebabCase } from './utils';
import type { OpenAPIV3 } from 'openapi-types';

const BASE_OAS_URL = 'https://api.eu1.stackone.com/oas';

interface MdxPage {
    [operationId: string]: {
        page: string;
        summary: string;
        path: string;
        method: string;
        tags: string[];
        deprecated?: boolean;
    };
}

/** Only `redirects` is read or written. Navigation is maintained by hand. */
interface DocsJson {
    redirects?: {
        source: string;
        destination: string;
    }[];
    [key: string]: unknown;
}

async function downloadOAS(url: string, category: Category): Promise<string> {
    try {
        const response = await axios.get(url);
        const tempFilePath = path.join(
            process.cwd(),
            category,
            'api-reference',
            `${category}-temp.json`,
        );

        // Ensure directory exists
        const dir = path.dirname(tempFilePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(tempFilePath, JSON.stringify(response.data, null, 2));
        return tempFilePath;
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to download OAS file: ${error.message}`);
        }
        throw new Error('Failed to download OAS file: Unknown error');
    }
}

function generateMdxPages(oasDoc: OpenAPIV3.Document, category: Category): MdxPage {
    const pages: MdxPage = {};

    for (const [pathKey, pathItem] of Object.entries(oasDoc.paths ?? {})) {
        if (!pathItem || typeof pathItem !== 'object') {
            continue;
        }

        for (const [method, operation] of Object.entries(pathItem)) {
            if (method === '$ref' || !operation || typeof operation !== 'object') {
                continue;
            }

            const opObject = operation as OpenAPIV3.OperationObject;
            const tags = opObject.tags || [];

            // Skip operations without tags
            if (tags.length === 0) {
                console.warn(`Warning: Operation ${opObject.operationId || pathKey} has no tags`);
                continue;
            }

            const summary =
                opObject.summary || opObject.operationId || pathKey.split('/').pop() || 'operation';

            // Build the page path: category/api-reference/tag1/tag2/.../tagN/summary
            const tagPath = tags.map((tag) => toKebabCase(tag)).join('/');
            const pagePath = `${category}/api-reference/${tagPath}/${toKebabCase(summary)}`;

            if (opObject.operationId) {
                pages[opObject.operationId] = {
                    page: pagePath,
                    summary,
                    path: pathKey,
                    method: method.toUpperCase(),
                    tags,
                    ...(opObject.deprecated && { deprecated: true }),
                };
            } else {
                console.warn(`Warning: Operation at ${pathKey} (${method}) has no operationId`);
            }
        }
    }

    return pages;
}

function generateMdxContent(pageInfo: MdxPage[string]): string {
    if (pageInfo.deprecated === true) {
        return `---
openapi: "${pageInfo.method.toLowerCase()} ${pageInfo.path}"
icon: "circle-exclamation"
---

<Warning>
  **This endpoint is deprecated**   <Icon icon="triangle-exclamation" color="#fbbf24" size={19} />
</Warning>`;
    }
    return `---
openapi: "${pageInfo.method.toLowerCase()} ${pageInfo.path}"
---`;
}

function docsJsonPath(): string {
    return path.join(process.cwd(), 'docs.json');
}

function readDocsJson(): DocsJson {
    try {
        return JSON.parse(fs.readFileSync(docsJsonPath(), 'utf8'));
    } catch (error) {
        if (error instanceof Error) {
            throw new Error(`Failed to read docs.json: ${error.message}`);
        }
        throw new Error('Failed to read docs.json: Unknown error');
    }
}

function updateRedirects(oldPages: MdxPage, newPages: MdxPage): void {
    const docsJson = readDocsJson();

    // Initialize redirects array if it doesn't exist
    if (!docsJson.redirects) {
        docsJson.redirects = [];
    }

    const redirects = docsJson.redirects;

    // Compare pages using operationId and add redirects for changed paths
    Object.entries(oldPages).forEach(([operationId, oldPage]) => {
        const newPage = newPages[operationId];
        if (newPage && oldPage.page !== newPage.page) {
            const redirect = {
                source: `/${oldPage.page}`,
                destination: `/${newPage.page}`,
            };

            // Check if redirect already exists
            const existingRedirectIndex = redirects.findIndex((r) => r.source === redirect.source);

            if (existingRedirectIndex === -1) {
                redirects.push(redirect);
            } else {
                redirects[existingRedirectIndex] = redirect;
            }
        }
    });

    // Write updated docs.json
    fs.writeFileSync(docsJsonPath(), `${JSON.stringify(docsJson, null, 2)}\n`);
}

/**
 * Paths that docs.json redirects away from. A page there would be unreachable.
 *
 * Reads through readDocsJson so an unreadable docs.json throws rather than
 * yielding an empty set, which would silently recreate every retired page.
 */
function retiredPaths(): Set<string> {
    const docsJson = readDocsJson();
    return new Set((docsJson.redirects ?? []).map((redirect) => redirect.source));
}

function writeMdxFiles(pages: MdxPage): { created: number; skipped: number } {
    let created = 0;
    let skipped = 0;
    const retired = retiredPaths();

    Object.values(pages).forEach((pageInfo) => {
        const mdxDir = path.join(process.cwd(), path.dirname(pageInfo.page));
        const mdxPath = path.join(process.cwd(), `${pageInfo.page}.mdx`);

        // A redirect from this path wins over a page at it, so recreating the page
        // would leave it unreachable. Deprecated endpoints removed from the docs stay
        // removed until their redirect is dropped.
        if (retired.has(`/${pageInfo.page}`)) {
            console.log(
                `Skipped retired MDX file: ${pageInfo.page} (${pageInfo.method} ${pageInfo.path}) - docs.json redirects this path`,
            );
            skipped++;
            return;
        }

        // Ensure directory exists
        if (!fs.existsSync(mdxDir)) {
            fs.mkdirSync(mdxDir, { recursive: true });
        }

        // Only create the file if it does not already exist
        if (fs.existsSync(mdxPath)) {
            console.log(
                `Skipped existing MDX file: ${pageInfo.page} (${pageInfo.method} ${pageInfo.path})`,
            );
            skipped++;
            return;
        }

        // Generate and write MDX content
        const mdxContent = generateMdxContent(pageInfo);
        fs.writeFileSync(mdxPath, mdxContent);

        // Log creation with verbose output including deprecated status
        const deprecatedStatus = pageInfo.deprecated ? ' [DEPRECATED]' : '';
        console.log(
            `Created MDX file: ${pageInfo.page} (${pageInfo.method} ${pageInfo.path})${deprecatedStatus}`,
        );
        created++;
    });

    return { created, skipped };
}

function cleanupOldFiles(newPages: MdxPage, category: Category): void {
    const apiRefPath = path.join(process.cwd(), category, 'api-reference');
    if (!fs.existsSync(apiRefPath)) {
        return;
    }

    // Get all the new page paths that should exist
    const validPaths = new Set(
        Object.values(newPages).map((page) => path.join(process.cwd(), `${page.page}.mdx`)),
    );

    // Helper function to recursively remove empty directories
    const removeEmptyDirs = (dirPath: string): boolean => {
        if (!fs.existsSync(dirPath)) {
            return true;
        }

        let isEmpty = true;
        const items = fs.readdirSync(dirPath);

        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                // If directory is not empty after recursive call, mark current dir as not empty
                const isDirEmpty = removeEmptyDirs(fullPath);
                if (!isDirEmpty) {
                    isEmpty = false;
                }
            } else {
                // For files, check if they should exist
                if (item === `${category}.json` || item === `${category}-temp.json`) {
                    continue;
                }

                if (!validPaths.has(fullPath)) {
                    console.log(`Removing old file: ${fullPath}`);
                    fs.unlinkSync(fullPath);
                } else {
                    isEmpty = false;
                }
            }
        }

        // Remove directory if it's empty and not the api-reference root
        if (isEmpty && dirPath !== apiRefPath) {
            console.log(`Removing empty directory: ${dirPath}`);
            fs.rmdirSync(dirPath);
            return true;
        }

        return false;
    };

    // Start cleanup from api-reference directory
    removeEmptyDirs(apiRefPath);
}

async function processCategory(category: Category): Promise<void> {
    console.log(`\nProcessing category: ${category}`);
    const oasUrl = `${BASE_OAS_URL}/${category}.json`;

    try {
        // Download new OAS file
        const tempFilePath = await downloadOAS(oasUrl, category);

        // Read current OAS file
        const currentOasPath = path.join(
            process.cwd(),
            category,
            'api-reference',
            `${category}.json`,
        );
        let currentPages: MdxPage = {};

        // Only try to generate paths from current OAS if it exists
        if (fs.existsSync(currentOasPath)) {
            try {
                const currentOas = JSON.parse(fs.readFileSync(currentOasPath, 'utf8'));
                currentPages = generateMdxPages(currentOas, category);
            } catch (error) {
                if (error instanceof Error) {
                    console.error(
                        `Error reading current OAS file for ${category}: ${error.message}`,
                    );
                }
                throw error;
            }
        } else {
            console.log(
                `No existing OAS file found for ${category}. This appears to be initial setup.`,
            );
        }

        // Generate paths from new OAS
        const newOas = JSON.parse(fs.readFileSync(tempFilePath, 'utf8')) as OpenAPIV3.Document;
        const newPages = generateMdxPages(newOas, category);

        // Only update redirects if we have current paths to compare against
        if (Object.keys(currentPages).length > 0) {
            updateRedirects(currentPages, newPages);
            console.log(`Successfully processed redirects for ${category}`);
        } else {
            console.log(`No redirects to update for ${category} - no existing OAS file`);
        }

        // Clean up old files and directories
        cleanupOldFiles(newPages, category);
        console.log(`Cleaned up old files for ${category}`);

        // Generate MDX files for all operations in the new OAS
        const { created, skipped } = writeMdxFiles(newPages);
        console.log(`Generated ${created} MDX files for ${category} (${skipped} files skipped)`);

        // Move temp file to final location
        fs.renameSync(tempFilePath, currentOasPath);
        console.log(`Moved ${category}-temp.json to ${category}.json`);
    } catch (error) {
        console.error(
            `Failed to process ${category}:`,
            error instanceof Error ? error.message : 'Unknown error',
        );
        throw error;
    }
}

async function main() {
    // Optional: Allow processing specific category if provided
    const targetCategory = process.argv[2];

    if (targetCategory) {
        if (!CATEGORIES.includes(targetCategory as Category)) {
            console.error(
                `Error: Invalid category "${targetCategory}". Valid categories are: ${CATEGORIES.join(', ')}`,
            );
            process.exit(1);
        }
        await processCategory(targetCategory as Category);
        return;
    }

    // Process all categories
    console.log('Processing all categories...');
    const errors: string[] = [];

    for (const category of CATEGORIES) {
        try {
            await processCategory(category);
        } catch (_error) {
            errors.push(category);
        }
    }

    // Report results
    if (errors.length > 0) {
        console.error('\nFailed to process the following categories:');
        errors.forEach((category) => console.error(`- ${category}`));
        process.exit(1);
    } else {
        console.log('\nSuccessfully processed all categories!');
    }
}

main();
