import { readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { PromptItem, PromptCategory } from '../../types';

/**
 * 自动扫描并加载指定目录下的所有 prompt 文件
 * @param dir 要扫描的目录路径
 * @returns PromptItem 数组
 */
export function scanPrompts(dir: string): PromptItem[] {
  const prompts: PromptItem[] = [];
  
  try {
    const items = readdirSync(dir);
    
    for (const item of items) {
      const fullPath = join(dir, item);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory()) {
        // 如果是目录，递归扫描
        const subPrompts = scanPrompts(fullPath);
        prompts.push(...subPrompts);
      } else if (
        stat.isFile() &&
        isPromptModuleFile(item)
      ) {
        // 如果是 TypeScript 文件，尝试导入
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const module = require(fullPath);
          Object.values(module).forEach((value: any) => {
            if (
              value && 
              typeof value === 'object' && 
              'title' in value &&
              'content' in value &&
              'id' in value
            ) {
              prompts.push(value as PromptItem);
            }
          });
        } catch (error) {
          console.error(`Error loading prompt file ${fullPath}:`, error);
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error);
  }
  
  return prompts;
}

/**
 * 自动扫描并创建分类信息
 * @param dir 要扫描的目录路径
 * @returns PromptCategory 数组
 */
export function scanCategories(dir: string): PromptCategory[] {
  const categories: PromptCategory[] = [];
  
  try {
    const items = readdirSync(dir);
    
    for (const item of items) {
      const fullPath = join(dir, item);
      const stat = statSync(fullPath);
      
      if (stat.isDirectory() && 
          !item.startsWith('.') && 
          item !== 'node_modules') {
        
        // 检查目录下是否有 index.ts 或 index.js 文件
        const indexTs = join(fullPath, 'index.ts');
        const indexJs = join(fullPath, 'index.js');
        try {
          if (!existsSync(indexTs) && !existsSync(indexJs)) {
            throw new Error('no index file');
          }
          
          // 创建分类信息
          const category: PromptCategory = {
            id: item,
            name: item,
            description: `${item} 相关Prompt`,
            icon: getCategoryIcon(item),
            sortOrder: getSortOrder(item),
          };
          
          categories.push(category);
        } catch {
          // 如果没有 index.ts 文件，递归扫描子目录
          const subCategories = scanCategories(fullPath);
          categories.push(...subCategories);
        }
      }
    }
  } catch (error) {
    console.error(`Error scanning categories in directory ${dir}:`, error);
  }
  
  return categories;
}

/**
 * 判断是否为可加载的 prompt 模块文件
 * 支持打包后运行时的 .js，以及开发期 .ts（排除 .d.ts）
 */
function isPromptModuleFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  const isIndex = lower === 'index.ts' || lower === 'index.js';
  const isSelf = lower === 'autoloader.ts' || lower === 'autoloader.js';

  if (isIndex || isSelf) return false;

  return (
    (lower.endsWith('.js') || lower.endsWith('.ts')) &&
    !lower.endsWith('.d.ts')
  );
}

/**
 * 根据分类名称获取图标
 * @param categoryName 分类名称
 * @returns 图标名称
 */
function getCategoryIcon(categoryName: string): string {
  const iconMap: Record<string, string> = {
    'coding': 'code',
    'writing': 'book',
    'general': 'symbol-misc',
    'development': 'tools',
    'design': 'paintcan',
    'analysis': 'search',
    'business': 'briefcase',
    'uidesign': 'paintbrush',
    'other': 'chat',
  };
  
  return iconMap[categoryName.toLowerCase()] || 'folder';
}

/**
 * 根据分类名称获取排序权重
 * @param categoryName 分类名称
 * @returns 排序权重
 */
function getSortOrder(categoryName: string): number {
  const orderMap: Record<string, number> = {
    'general': 0,
    'coding': 1,
    'writing': 2,
    'development': 3,
    'design': 4,
    'analysis': 5,
    'business': 6,
    'uidesign': 7,
    'other': 8,
  };
  
  return orderMap[categoryName.toLowerCase()] || 999;
} 
