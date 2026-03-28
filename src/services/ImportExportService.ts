import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { IImportExportService, ExportData, PromptItem, PromptCategory } from "../types";
import { FILE_CONSTANTS, UI_CONSTANTS, generateUniqueId } from "../constants/constants";

/**
 * 导入导出服务实现
 * 处理JSON文件的导入导出功能
 */
export class ImportExportService implements IImportExportService {
  private static instance: ImportExportService;

  /**
   * 获取单例实例
   */
  static getInstance(): ImportExportService {
    if (!ImportExportService.instance) {
      ImportExportService.instance = new ImportExportService();
    }
    return ImportExportService.instance;
  }

  private constructor() {
    // 私有构造函数，确保单例模式
  }

  /**
   * 导出数据到文件
   * @param data 要导出的数据
   * @param filePath 文件路径
   */
  async exportToFile(data: ExportData, filePath: string): Promise<void> {
    if (!data) {
      throw new Error("导出数据不能为空");
    }

    if (!filePath || filePath.trim() === "") {
      throw new Error("文件路径不能为空");
    }

    try {
      // 确保导出数据包含必要信息
      const exportData: ExportData = {
        ...data,
        version: FILE_CONSTANTS.CURRENT_VERSION,
        exportedAt: new Date(),
        metadata: {
          totalCount: data.prompts.length,
          categoryCount: data.categories.length,
          exportedBy: "Prompt Manager",
          ...data.metadata,
        },
      };

      // 序列化数据
      const jsonString = JSON.stringify(exportData, null, 2);

      // 确保目录存在
      const dirname = path.dirname(filePath);
      try {
        await fs.access(dirname);
      } catch {
        await fs.mkdir(dirname, { recursive: true });
      }

      // 写入文件
      await fs.writeFile(filePath, jsonString, "utf8");

      console.log(`数据导出成功: ${filePath}`);
      console.log(`导出了 ${data.prompts.length} 个Prompt，${data.categories.length} 个分类`);
    } catch (error) {
      console.error("导出文件失败:", error);

      if (error instanceof Error) {
        if (error.message.includes("EACCES")) {
          throw new Error("文件写入权限不足，请检查文件路径权限");
        } else if (error.message.includes("ENOSPC")) {
          throw new Error("磁盘空间不足");
        } else if (error.message.includes("ENOENT")) {
          throw new Error("文件路径无效");
        }
      }

      throw new Error(`导出失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  /**
   * 从文件导入数据
   * @param filePath 文件路径
   * @returns 导入的数据
   */
  async importFromFile(filePath: string): Promise<ExportData> {
    if (!filePath || filePath.trim() === "") {
      throw new Error("文件路径不能为空");
    }

    try {
      // 检查文件是否存在
      await fs.access(filePath, fs.constants.F_OK);

      // 读取文件内容
      const fileContent = await fs.readFile(filePath, "utf8");

      if (!fileContent || fileContent.trim() === "") {
        throw new Error("文件内容为空");
      }

      // 解析JSON
      let parsedData: any;
      try {
        parsedData = JSON.parse(fileContent);
      } catch (jsonError) {
        throw new Error("文件格式无效，不是有效的JSON格式");
      }

      // 验证数据格式
      const isValid = await this.validateImportData(parsedData);
      if (!isValid) {
        throw new Error("文件格式不符合Prompt Manager导出格式");
      }

      // 构建导入数据
      const importData: ExportData = {
        version: parsedData.version || FILE_CONSTANTS.CURRENT_VERSION,
        exportedAt: new Date(parsedData.exportedAt || Date.now()),
        prompts: this.sanitizePrompts(parsedData.prompts || []),
        categories: this.sanitizeCategories(parsedData.categories || []),
        metadata: parsedData.metadata || {},
      };

      console.log(`数据导入成功: ${filePath}`);
      console.log(`导入了 ${importData.prompts.length} 个Prompt，${importData.categories.length} 个分类`);

      return importData;
    } catch (error) {
      console.error("导入文件失败:", error);

      if (error instanceof Error) {
        if (error.message.includes("ENOENT")) {
          throw new Error("文件不存在，请检查文件路径");
        } else if (error.message.includes("EACCES")) {
          throw new Error("文件读取权限不足");
        }
      }

      throw error instanceof Error ? error : new Error("导入失败");
    }
  }

  /**
   * 验证导入数据格式
   * @param data 要验证的数据
   * @returns 是否有效
   */
  async validateImportData(data: any): Promise<boolean> {
    try {
      // 基础结构检查
      if (!data || typeof data !== "object") {
        return false;
      }

      // 检查版本
      if (data.version && !FILE_CONSTANTS.SUPPORTED_VERSIONS.includes(data.version)) {
        console.warn(`不支持的版本: ${data.version}`);
        // 警告但不阻止导入
      }

      // 检查必要字段
      if (!Array.isArray(data.prompts)) {
        console.error("prompts字段必须是数组");
        return false;
      }

      if (!Array.isArray(data.categories)) {
        console.error("categories字段必须是数组");
        return false;
      }

      // 验证Prompt数据
      for (const prompt of data.prompts) {
        if (!this.isValidPrompt(prompt)) {
          console.error("发现无效的Prompt数据:", prompt);
          return false;
        }
      }

      // 验证分类数据
      for (const category of data.categories) {
        if (!this.isValidCategory(category)) {
          console.error("发现无效的分类数据:", category);
          return false;
        }
      }

      return true;
    } catch (error) {
      console.error("验证导入数据时发生错误:", error);
      return false;
    }
  }

  /**
   * 导出预览数据
   * @param prompts Prompt列表
   * @param categories 分类列表
   * @returns 预览信息
   */
  async generateExportPreview(
    prompts: PromptItem[],
    categories: PromptCategory[]
  ): Promise<{
    summary: string;
    details: string[];
    estimatedSize: string;
  }> {
    try {
      const data: ExportData = {
        version: FILE_CONSTANTS.CURRENT_VERSION,
        exportedAt: new Date(),
        prompts,
        categories,
        metadata: {
          totalCount: prompts.length,
          categoryCount: categories.length,
        },
      };

      const jsonString = JSON.stringify(data, null, 2);
      const sizeInBytes = Buffer.byteLength(jsonString, "utf8");
      const sizeInKB = (sizeInBytes / 1024).toFixed(2);

      const summary = `准备导出 ${prompts.length} 个Prompt和 ${categories.length} 个分类`;

      const details = [
        `Prompt总数: ${prompts.length}`,
        `分类总数: ${categories.length}`,
        `有标签的Prompt: ${prompts.filter((p) => p.tags && p.tags.length > 0).length} 个`,
        `估计文件大小: ${sizeInKB} KB`,
      ];

      return {
        summary,
        details,
        estimatedSize: `${sizeInKB} KB`,
      };
    } catch (error) {
      console.error("生成导出预览失败:", error);
      throw new Error("生成预览失败");
    }
  }

  /**
   * 批量导出多个文件
   * @param dataList 要导出的数据列表
   * @param baseDir 基础目录
   */
  async batchExport(dataList: { data: ExportData; fileName: string }[], baseDir: string): Promise<string[]> {
    const exportedFiles: string[] = [];
    const errors: string[] = [];

    for (const { data, fileName } of dataList) {
      try {
        const filePath = path.join(baseDir, fileName);
        await this.exportToFile(data, filePath);
        exportedFiles.push(filePath);
      } catch (error) {
        const errorMsg = `导出 ${fileName} 失败: ${error instanceof Error ? error.message : "未知错误"}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    if (errors.length > 0) {
      throw new Error(`部分文件导出失败:\n${errors.join("\n")}`);
    }

    return exportedFiles;
  }

  // 私有方法

  /**
   * 清理和标准化Prompt数据
   */
  private sanitizePrompts(prompts: any[]): PromptItem[] {
    return prompts
      .filter((prompt) => this.isValidPrompt(prompt))
      .map((prompt) => ({
        id: prompt.id || this.generateId(),
        title: String(prompt.title || "").trim(),
        content: String(prompt.content || "").trim(),
        categoryId: prompt.categoryId ? String(prompt.categoryId) : undefined,
        tags: Array.isArray(prompt.tags)
          ? prompt.tags.map((tag: any) => String(tag).trim()).filter((tag: string) => tag.length > 0)
          : undefined,
        // createdAt: prompt.createdAt ? new Date(prompt.createdAt) : new Date(),
        updatedAt: prompt.updatedAt ? new Date(prompt.updatedAt) : new Date(),
        usageCount: Number(prompt.usageCount) || 0,
      }));
  }

  /**
   * 清理和标准化分类数据
   */
  private sanitizeCategories(categories: any[]): PromptCategory[] {
    return categories
      .filter((category) => this.isValidCategory(category))
      .map((category) => ({
        id: category.id || this.generateId(),
        name: String(category.name || "").trim(),
        description: category.description ? String(category.description).trim() : undefined,
        icon: category.icon ? String(category.icon).trim() : undefined,
        sortOrder: Number(category.sortOrder) || 0,
        createdAt: category.createdAt ? new Date(category.createdAt) : new Date(),
      }));
  }

  /**
   * 验证Prompt数据有效性
   */
  private isValidPrompt(prompt: any): boolean {
    return (
      prompt &&
      typeof prompt === "object" &&
      typeof prompt.title === "string" &&
      prompt.title.trim().length > 0 &&
      typeof prompt.content === "string" &&
      prompt.content.trim().length > 0
    );
  }

  /**
   * 验证分类数据有效性
   */
  private isValidCategory(category: any): boolean {
    return (
      category && typeof category === "object" && typeof category.name === "string" && category.name.trim().length > 0
    );
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return generateUniqueId('imp');
  }
}
