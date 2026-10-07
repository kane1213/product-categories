import fs from 'fs';
import path from 'path';

const dataPath = path.join(process.cwd(), 'src/content/products.json');

export const PRODUCTS = fs.readFileSync(dataPath, 'utf-8');
