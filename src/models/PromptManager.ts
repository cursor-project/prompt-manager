import * as vscode from "vscode";
import {
  IPromptManager,
  PromptItem,
  PromptCategory,
  ExportData,
  SearchOptions,
  PromptStats,
  PromptActionType,
  PromptActionResult,
} from "../types";
import { StorageService } from "../services/StorageService";
import { ClipboardService } from "../services/ClipboardService";
import { UIService } from "../services/UIService";
import { ImportExportService } from "../services/ImportExportService";
import { CursorIntegrationService } from "../services/CursorIntegrationService";
import { ChatIntegrationFactory } from "../services/ChatIntegrationFactory";
import { ChatIntegrationOptions, ChatIntegrationStatus, EditorEnvironmentType } from "../types";
import { DEFAULT_CATEGORIES, DEFAULT_PROMPTS } from "../constants/constants";
import { t } from "../services/LocalizationService";

/**
 * Prompt管理器 - 核心业务逻辑
 * 协调所有服务，提供完整的Prompt管理功能
 */
export class PromptManager implements IPromptManager {
  private static instance: PromptManager;

  private storageService!: StorageService;
  private clipboardService: ClipboardService;
  private uiService: UIService;
  private importExportService: ImportExportService;
  private cursorIntegrationService: CursorIntegrationService;
  private chatIntegrationFactory: ChatIntegrationFactory;
  private context: vscode.ExtensionContext | null = null;

  private readonly _onDidPromptsChange = new vscode.EventEmitter<void>();
  public readonly onDidPromptsChange = this._onDidPromptsChange.event;

  /**
   * 获取单例实例
   */
  static getInstance(): PromptManager {
    if (!PromptManager.instance) {
      PromptManager.instance = new PromptManager();
    }
    return PromptManager.instance;
  }

  private constructor() {
    // 服务将在initialize中初始化
    this.clipboardService = ClipboardService.getInstance();
    this.uiService = UIService.getInstance();
    this.importExportService = ImportExportService.getInstance();
    this.cursorIntegrationService = CursorIntegrationService.getInstance();
    this.chatIntegrationFactory = ChatIntegrationFactory.getInstance();
  }

  /**
   * 初始化管理器
   * @param context VSCode扩展上下文
   */
  async initialize(context: vscode.ExtensionContext): Promise<void> {
    try {
      this.context = context;

      // 初始化存储服务
      this.storageService = new StorageService(context);
      await this.storageService.initialize();

      // 检查是否是首次使用
      await this.ensureDefaultData();

      console.log("PromptManager 初始化完成");
    } catch (error) {
      console.error("PromptManager 初始化失败:", error);
      await this.uiService.showError(t("error.initializationFailed"));
      throw error;
    }
  }

  // Prompt 管理方法

  /**
   * 显示Prompt选择器
   */
  async showPromptPicker(): Promise<void> {
    try {
      const prompts = await this.storageService.getPrompts();

      if (prompts.length === 0) {
        await this.uiService.showInfo(t("error.noPrompts"));
        return;
      }

      const selectedPrompt = await this.uiService.showPromptPicker(prompts);

      if (selectedPrompt) {
        await this.handlePromptSelection(selectedPrompt);
      }
    } catch (error) {
      console.error("显示Prompt选择器失败:", error);
      await this.uiService.showError(t("error.showPromptsFailed"));
    }
  }

  /**
   * 添加新Prompt
   */
  async addPrompt(): Promise<void> {
    try {
      const newPrompt = await this.uiService.showPromptEditor(undefined, this.context || undefined);

      if (newPrompt) {
        await this.storageService.savePrompt(newPrompt);
        this._onDidPromptsChange.fire();
        await this.uiService.showInfo(t("message.promptAdded", newPrompt.title));
      }
    } catch (error) {
      console.error("添加Prompt失败:", error);
      await this.uiService.showError(t("error.addPromptFailed"));
    }
  }

  /**
   * 编辑Prompt
   * @param promptId Prompt ID
   */
  async editPrompt(promptId: string): Promise<void> {
    try {
      const prompt = await this.storageService.getPrompt(promptId);

      if (!prompt) {
        await this.uiService.showError(t("message.promptNotFound"));
        return;
      }

      const editedPrompt = await this.uiService.showPromptEditor(prompt, this.context || undefined);

      if (editedPrompt) {
        await this.storageService.savePrompt(editedPrompt);
        this._onDidPromptsChange.fire();
        await this.uiService.showInfo(t("message.promptUpdated", editedPrompt.title));
      }
    } catch (error) {
      console.error("编辑Prompt失败:", error);
      await this.uiService.showError(t("error.editPromptFailed"));
    }
  }

  /**
   * 删除Prompt
   * @param promptId Prompt ID
   */
  async deletePrompt(promptId: string): Promise<void> {
    try {
      const prompt = await this.storageService.getPrompt(promptId);

      if (!prompt) {
        await this.uiService.showError(t("message.promptNotFound"));
        return;
      }

      const confirmed = await this.uiService.showConfirmDialog(t("message.confirmDelete", prompt.title));

      if (confirmed) {
        await this.storageService.deletePrompt(promptId);
        this._onDidPromptsChange.fire();
        await this.uiService.showInfo(t("message.promptDeleted", prompt.title));
      }
    } catch (error) {
      console.error("删除Prompt失败:", error);
      await this.uiService.showError(t("error.deletePromptFailed"));
    }
  }

  /**
   * 复制Prompt到剪贴板
   * @param promptId Prompt ID
   */
  async copyPromptToClipboard(promptId: string): Promise<void> {
    try {
      const prompt = await this.storageService.getPrompt(promptId);

      if (!prompt) {
        await this.uiService.showError(t("message.promptNotFound"));
        return;
      }

      // 复制到剪贴板
      await this.clipboardService.copyPrompt(prompt.title, prompt.content, true);

      await this.uiService.showInfo(t("message.promptCopied", prompt.title));
    } catch (error) {
      console.error("复制Prompt失败:", error);
      await this.uiService.showError("复制失败");
    }
  }

  // 搜索和过滤方法

  /**
   * 搜索Prompt
   * @param keyword 搜索关键词
   * @param options 搜索选项
   */
  async searchPrompts(keyword: string, options?: SearchOptions): Promise<PromptItem[]> {
    try {
      const [allPrompts, categories] = await Promise.all([
        this.storageService.getPrompts(),
        this.storageService.getCategories(),
      ]);

      if (!keyword || keyword.trim() === "") {
        return allPrompts;
      }

      const searchTerm = keyword.toLowerCase().trim();
      const matchedPrompts: PromptItem[] = [];

      // 搜索Prompt内容
      for (const prompt of allPrompts) {
        let isMatch = false;

        // 搜索标题（默认启用）
        if (prompt.title.toLowerCase().includes(searchTerm)) {
          isMatch = true;
        }
        // 搜索内容
        else if (options?.includeContent !== false && prompt.content.toLowerCase().includes(searchTerm)) {
          isMatch = true;
        }
        // 搜索标签
        else if (options?.includeTags !== false && prompt.tags?.some((tag) => tag.toLowerCase().includes(searchTerm))) {
          isMatch = true;
        }

        if (isMatch) {
          matchedPrompts.push(prompt);
        }
      }

      // 搜索分类名称
      const matchedCategoryIds: string[] = [];
      for (const category of categories) {
        if (
          category.name.toLowerCase().includes(searchTerm) ||
          category.description?.toLowerCase().includes(searchTerm)
        ) {
          matchedCategoryIds.push(category.id);
        }
      }

      // 添加匹配分类下的所有Prompt
      for (const categoryId of matchedCategoryIds) {
        const categoryPrompts = allPrompts.filter((p) => p.categoryId === categoryId);
        for (const prompt of categoryPrompts) {
          if (!matchedPrompts.some((mp) => mp.id === prompt.id)) {
            matchedPrompts.push(prompt);
          }
        }
      }

      return matchedPrompts;
    } catch (error) {
      console.error("搜索Prompt失败:", error);
      return [];
    }
  }

  /**
   * 搜索Prompt并返回分类信息
   * @param keyword 搜索关键词
   * @param options 搜索选项
   */
  async searchWithCategories(
    keyword: string,
    options?: SearchOptions
  ): Promise<{ prompt: PromptItem; categoryName: string }[]> {
    try {
      const [searchResults, categories] = await Promise.all([
        this.searchPrompts(keyword, options),
        this.storageService.getCategories(),
      ]);

      return searchResults.map((prompt) => {
        const category = categories.find((c) => c.id === prompt.categoryId);
        return {
          prompt,
          categoryName: category ? category.name : "未分类",
        };
      });
    } catch (error) {
      console.error("搜索Prompt失败:", error);
      return [];
    }
  }

  /**
   * 按分类获取Prompt
   * @param categoryId 分类ID
   */
  async getPromptsByCategory(categoryId: string): Promise<PromptItem[]> {
    try {
      const allPrompts = await this.storageService.getPrompts();
      const filtered = allPrompts.filter((prompt) => prompt.categoryId === categoryId);
      return filtered;
    } catch (error) {
      console.error("获取分类Prompt失败:", error);
      return [];
    }
  }

  // 分类管理方法

  /**
   * 获取所有分类
   */
  async getAllCategories(): Promise<PromptCategory[]> {
    return await this.storageService.getCategories();
  }

  /**
   * 添加分类
   * @param category 分类信息
   */
  async addCategory(category: Omit<PromptCategory, "id" | "createdAt">): Promise<void> {
    try {
      const newCategory: PromptCategory = {
        ...category,
        id: this.generateId(),
      };

      await this.storageService.saveCategory(newCategory);
      this._onDidPromptsChange.fire();
      await this.uiService.showInfo(
        `✨ 分类创建成功！\n\n📁 分类名称: ${category.name}\n📝 描述: ${category.description || "无"
        }\n🕒 创建时间: ${new Date().toLocaleString()}`
      );
    } catch (error) {
      console.error("添加分类失败:", error);
      await this.uiService.showError("添加分类失败");
    }
  }

  /**
   * 导出指定分类的Prompt
   * @param categoryId 分类ID
   */
  async exportCategoryPrompts(categoryId: string): Promise<void> {
    try {
      const [allPrompts, categories] = await Promise.all([
        this.storageService.getPrompts(),
        this.storageService.getCategories(),
      ]);

      let prompts: PromptItem[];
      let categoryName: string;

      if (categoryId === "__uncategorized__") {
        prompts = allPrompts.filter((p) => !p.categoryId || !categories.some((c) => c.id === p.categoryId));
        categoryName = "未分类";
      } else {
        prompts = allPrompts.filter((p) => p.categoryId === categoryId);
        const category = categories.find((c) => c.id === categoryId);
        categoryName = category ? category.name : "未知分类";
      }

      if (prompts.length === 0) {
        await this.uiService.showInfo(`${categoryName} 中没有Prompt可导出`);
        return;
      }

      // 选择保存路径
      const filePath = await this.uiService.showSaveDialog(`${categoryName}-prompts`);
      if (!filePath) {
        return;
      }

      // 准备导出数据
      const exportData: ExportData = {
        version: "1.0.0",
        exportedAt: new Date(),
        prompts,
        categories: [],
        metadata: {
          totalCount: prompts.length,
          categoryCount: 0,
          categoryName,
        },
      };

      // 保存到文件
      await this.importExportService.exportToFile(exportData, filePath);

      await this.uiService.showInfo(
        `🎉 导出成功！\n\n📁 分类: ${categoryName}\n📊 导出数据: ${prompts.length} 个Prompt\n💾 文件位置: ${filePath}`
      );
    } catch (error) {
      console.error("导出分类Prompt失败:", error);
      await this.uiService.showError("导出分类Prompt失败");
    }
  }

  /**
   * 编辑分类信息
   * @param categoryId 分类ID
   */
  async editCategory(categoryId: string): Promise<void> {
    try {
      const categories = await this.storageService.getCategories();
      const category = categories.find((c) => c.id === categoryId);

      if (!category) {
        await this.uiService.showError("分类不存在");
        return;
      }

      const editedCategory = await this.uiService.showCategoryEditor(category);

      if (editedCategory) {
        await this.storageService.updateCategory(editedCategory);
        // 触发数据变更事件，确保UI刷新
        this._onDidPromptsChange.fire();
        await this.uiService.showInfo(`分类 "${editedCategory.name}" 更新成功`);
      }
    } catch (error) {
      console.error("编辑分类失败:", error);
      await this.uiService.showError("编辑分类失败");
    }
  }

  /**
   * 删除分类
   * @param categoryId 分类ID
   */
  async deleteCategory(categoryId: string): Promise<void> {
    try {
      const [categories, allPrompts] = await Promise.all([
        this.storageService.getCategories(),
        this.storageService.getPrompts(),
      ]);

      const category = categories.find((c) => c.id === categoryId);
      if (!category) {
        await this.uiService.showError("分类不存在");
        return;
      }

      const categoryPrompts = allPrompts.filter((p) => p.categoryId === categoryId);
      const confirmMessage =
        categoryPrompts.length > 0
          ? `确定要删除分类 "${category.name}" 吗？\n\n该分类下有 ${categoryPrompts.length} 个Prompt，它们将变为未分类状态。`
          : `确定要删除分类 "${category.name}" 吗？`;

      const confirmed = await this.uiService.showConfirmDialog(confirmMessage);
      if (!confirmed) {
        return;
      }

      // 将分类下的Prompt设为未分类
      for (const prompt of categoryPrompts) {
        await this.storageService.updatePrompt({
          ...prompt,
          categoryId: undefined,
        });
      }

      // 删除分类
      await this.storageService.deleteCategory(categoryId);

      // 触发数据变更事件，确保UI刷新
      this._onDidPromptsChange.fire();

      await this.uiService.showInfo(
        `分类 "${category.name}" 删除成功${categoryPrompts.length > 0 ? `，${categoryPrompts.length} 个Prompt已移至未分类` : ""
        }`
      );
    } catch (error) {
      console.error("删除分类失败:", error);
      await this.uiService.showError("删除分类失败");
    }
  }

  // 导入导出方法

  /**
   * 导出所有数据（返回数据对象）
   */
  async exportData(): Promise<ExportData> {
    try {
      const prompts = await this.storageService.getPrompts();
      const categories = await this.storageService.getCategories();

      // 准备导出数据
      const exportData: ExportData = {
        version: "1.0.0",
        exportedAt: new Date(),
        prompts,
        categories,
        metadata: {
          totalCount: prompts.length,
          categoryCount: categories.length,
        },
      };

      return exportData;
    } catch (error) {
      console.error("导出数据失败:", error);
      throw new Error(`导出数据失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  /**
   * 导出数据到文件（用户交互版本）
   */
  async exportToFile(): Promise<void> {
    try {
      // 选择保存路径
      const filePath = await this.uiService.showSaveDialog("prompt-backup");

      if (!filePath) {
        return; // 用户取消了操作
      }

      // 获取导出数据
      const exportData = await this.exportData();

      // 保存到文件
      await this.importExportService.exportToFile(exportData, filePath);

      await this.uiService.showInfo(
        `🎉 导出成功！\n\n📁 文件位置: ${filePath}\n📊 导出数据: ${exportData.prompts.length} 个Prompt, ${exportData.categories.length} 个分类`
      );
    } catch (error) {
      console.error("导出文件失败:", error);
      await this.uiService.showError(`导出失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  /**
   * 导入数据（接受数据对象）
   */
  async importData(data: ExportData): Promise<void> {
    try {
      await this.performImport(data);
    } catch (error) {
      console.error("导入数据失败:", error);
      throw new Error(`导入数据失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  /**
   * 从文件导入数据（用户交互版本）
   */
  async importFromFile(): Promise<void> {
    try {
      // 选择文件
      const filePath = await this.uiService.showOpenDialog();

      if (!filePath) {
        return;
      }

      // 导入数据
      const importData = await this.importExportService.importFromFile(filePath);

      // 显示导入预览
      const message = `准备导入 ${importData.prompts.length} 个Prompt和 ${importData.categories.length} 个分类\n\n是否继续？`;
      const confirmed = await this.uiService.showConfirmDialog(message);

      if (!confirmed) {
        return;
      }

      // 执行导入
      await this.importData(importData);
      await this.uiService.showInfo(
        `🎉 导入成功！\n\n📊 已导入: ${importData.prompts.length} 个Prompt, ${importData.categories.length
        } 个分类\n🕒 导入时间: ${new Date().toLocaleString()}`
      );
    } catch (error) {
      console.error("从文件导入失败:", error);
      await this.uiService.showError(`导入失败: ${error instanceof Error ? error.message : "未知错误"}`);
    }
  }

  // 统计方法

  /**
   * 获取统计信息
   */
  async getStats(): Promise<PromptStats> {
    try {
      return await this.storageService.getStats();
    } catch (error) {
      console.error("获取统计信息失败:", error);
      return {
        totalPrompts: 0,
        totalCategories: 0,
        topCategories: [],
      };
    }
  }

  // 私有方法

  /**
   * 确保默认数据存在
   */
  private async ensureDefaultData(): Promise<void> {
    try {
      const prompts = await this.storageService.getPrompts();
      const categories = await this.storageService.getCategories();

      // 检查并补充缺失的默认分类
      const existingCategoryIds = new Set(categories.map((c) => c.id));
      const missingCategories = Object.values(DEFAULT_CATEGORIES).filter(
        (defaultCategory) => !existingCategoryIds.has(defaultCategory.id)
      );

      if (missingCategories.length > 0) {
        console.log(`发现 ${missingCategories.length} 个缺失的默认分类，正在补充...`);
        for (const defaultCategory of missingCategories) {
          await this.storageService.saveCategory(defaultCategory);
          console.log(`已补充默认分类: ${defaultCategory.name} (${defaultCategory.id})`);
        }
      }

      // 如果完全没有分类，创建所有默认分类
      if (categories.length === 0) {
        for (const defaultCategory of Object.values(DEFAULT_CATEGORIES)) {
          await this.storageService.saveCategory(defaultCategory);
        }
        console.log("已创建默认分类");
      }

      // 检查并补充缺失的默认 Prompt
      const existingPromptIds = new Set(prompts.map((p) => p.id));
      const missingPrompts = DEFAULT_PROMPTS.filter((defaultPrompt) => !existingPromptIds.has(defaultPrompt.id));

      if (missingPrompts.length > 0) {
        console.log(`发现 ${missingPrompts.length} 个缺失的默认 Prompt，正在补充...`);
        for (const defaultPrompt of missingPrompts) {
          // 类型转换以解决readonly兼容性问题
          const promptItem: PromptItem = {
            ...defaultPrompt,
            tags: defaultPrompt.tags ? [...defaultPrompt.tags] : undefined,
          };
          await this.storageService.savePrompt(promptItem);
          console.log(`已补充默认 Prompt: ${defaultPrompt.title} (${defaultPrompt.id})`);
        }
      }

      // 如果完全没有 Prompt，创建所有默认示例
      if (prompts.length === 0) {
        for (const defaultPrompt of DEFAULT_PROMPTS) {
          // 类型转换以解决readonly兼容性问题
          const promptItem: PromptItem = {
            ...defaultPrompt,
            tags: defaultPrompt.tags ? [...defaultPrompt.tags] : undefined,
          };
          await this.storageService.savePrompt(promptItem);
        }
        console.log("已创建默认示例Prompt");
      }
    } catch (error) {
      console.error("创建默认数据失败:", error);
    }
  }

  /**
   * 处理Prompt选择
   */
  private async handlePromptSelection(prompt: PromptItem): Promise<void> {
    try {
      // 读取配置中的默认操作
      const config = vscode.workspace.getConfiguration("promptManager");
      const defaultAction = config.get<string>("defaultAction", "copy");

      // 根据配置映射到对应的操作类型
      const actionType = defaultAction === "chat" ? PromptActionType.SEND_TO_CHAT : PromptActionType.COPY_TO_CLIPBOARD;

      // 执行相应的操作
      await this.executePromptAction(prompt.id, actionType);
    } catch (error) {
      console.error("处理Prompt选择失败:", error);
      await this.uiService.showError("操作失败");
    }
  }

  /**
   * 执行数据导入
   */
  private async performImport(importData: ExportData): Promise<void> {
    try {
      // 导入分类
      for (const category of importData.categories) {
        try {
          await this.storageService.saveCategory(category);
        } catch (error) {
          console.warn(`导入分类 ${category.name} 失败:`, error);
        }
      }

      // 导入Prompt
      for (const prompt of importData.prompts) {
        try {
          await this.storageService.savePrompt(prompt);
        } catch (error) {
          console.warn(`导入Prompt ${prompt.title} 失败:`, error);
        }
      }
    } catch (error) {
      console.error("执行导入失败:", error);
      throw error;
    }
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return "pm_" + Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  // 实现IPromptManager接口缺失的方法

  /**
   * 获取所有Prompt（接口方法）
   */
  async getAllPrompts(): Promise<PromptItem[]> {
    return await this.storageService.getPrompts();
  }

  /**
   * 创建新Prompt（接口方法）
   */
  async createPrompt(prompt: Omit<PromptItem, "id">): Promise<PromptItem> {
    const newPrompt: PromptItem = {
      ...prompt,
      id: this.generateId(),
    };

    await this.storageService.savePrompt(newPrompt);
    return newPrompt;
  }

  /**
   * 更新Prompt（接口方法）
   */
  async updatePrompt(prompt: PromptItem): Promise<void> {
    try {
      await this.storageService.updatePrompt(prompt);
      this._onDidPromptsChange.fire();
    } catch (error) {
      console.error("更新Prompt失败:", error);
      await this.uiService.showError("更新Prompt失败");
    }
  }

  /**
   * 获取存储服务实例（用于TreeView）
   */
  getStorageService(): StorageService {
    if (!this.storageService) {
      throw new Error("PromptManager未初始化，请先调用initialize方法");
    }
    return this.storageService;
  }

  // Cursor集成方法

  /**
   * 发送Prompt到Chat窗口（支持多编辑器）
   * @param promptId Prompt ID
   */
  async sendPromptToChat(promptId: string): Promise<boolean> {
    try {
      const prompt = await this.storageService.getPrompt(promptId);
      if (!prompt) {
        await this.uiService.showError("Prompt不存在");
        return false;
      }

      // Chat集成功能默认启用
      const currentService = this.chatIntegrationFactory.getCurrentChatService();
      if (!currentService) {
        await this.uiService.showInfo("当前环境不支持Chat集成");
        return false;
      }

      const chatOptions: ChatIntegrationOptions = {
        prompt: prompt.content,
        title: prompt.title,
        includeTitle: false, // 默认不包含标题
        addContext: false, // 默认不添加上下文
      };

      const integrationStatus = await currentService.getIntegrationStatus();
      const success = await currentService.sendToChat(chatOptions);

      if (success) {
        if (!(integrationStatus.isEditorEnvironment && !integrationStatus.isCommandAvailable)) {
          await this.uiService.showInfo(`Prompt "${prompt.title}" 已发送到Chat窗口`);
        }
        return true;
      } else {
        await this.uiService.showError("发送到Chat失败");
        return false;
      }
    } catch (error) {
      console.error("发送Prompt到Chat失败:", error);
      await this.uiService.showError("发送失败");
      return false;
    }
  }

  /**
   * 执行特定的Prompt操作
   * @param promptId Prompt ID
   * @param actionType 操作类型
   */
  async executePromptAction(promptId: string, actionType: PromptActionType): Promise<PromptActionResult> {
    try {
      const prompt = await this.storageService.getPrompt(promptId);
      if (!prompt) {
        return {
          success: false,
          actions: [],
          errors: ["Prompt不存在"],
        };
      }

      switch (actionType) {
        case PromptActionType.SEND_TO_CHAT:
        case PromptActionType.SEND_TO_CURSOR_CHAT:
          const success = await this.sendPromptToChat(promptId);
          return {
            success,
            actions: success ? ["发送到Chat"] : [],
            errors: success ? [] : ["发送到Chat失败"],
          };

        case PromptActionType.COPY_TO_CLIPBOARD:
          await this.copyPromptToClipboard(promptId);
          return {
            success: true,
            actions: ["复制到剪贴板"],
            errors: [],
          };

        case PromptActionType.EDIT:
          await this.editPrompt(promptId);
          return {
            success: true,
            actions: ["编辑Prompt"],
            errors: [],
          };

        case PromptActionType.DELETE:
          await this.deletePrompt(promptId);
          return {
            success: true,
            actions: ["删除Prompt"],
            errors: [],
          };

        default:
          return {
            success: false,
            actions: [],
            errors: ["未知的操作类型"],
          };
      }
    } catch (error) {
      console.error("执行Prompt操作失败:", error);
      const errorMessage = `操作失败: ${error instanceof Error ? error.message : String(error)}`;
      return {
        success: false,
        actions: [],
        errors: [errorMessage],
      };
    }
  }

  /**
   * 获取可用的操作类型列表
   * @param promptId Prompt ID
   */
  async getAvailableActions(promptId: string): Promise<PromptActionType[]> {
    try {
      const prompt = await this.storageService.getPrompt(promptId);
      if (!prompt) {
        return [];
      }

      const actions: PromptActionType[] = [
        PromptActionType.COPY_TO_CLIPBOARD,
        PromptActionType.EDIT,
        PromptActionType.DELETE,
      ];

      // 如果支持Chat集成，添加Chat选项
      try {
        const isSupported = await this.chatIntegrationFactory.isCurrentEnvironmentSupported();
        if (isSupported) {
          // Chat集成功能默认启用
          actions.splice(0, 0, PromptActionType.SEND_TO_CHAT);
        }
      } catch (error) {
        console.error("检查Chat集成支持失败:", error);
      }

      return actions;
    } catch (error) {
      console.error("获取可用操作失败:", error);
      return [];
    }
  }

  /**
   * 获取Cursor集成状态（保持向后兼容性）
   */
  async getCursorIntegrationStatus(): Promise<{
    isCursorEnvironment: boolean;
    isCommandAvailable: boolean;
    hasActiveEditor: boolean;
  }> {
    const status = await this.cursorIntegrationService.getIntegrationStatus();
    return {
      isCursorEnvironment: status.isEditorEnvironment,
      isCommandAvailable: status.isCommandAvailable,
      hasActiveEditor: status.hasActiveEditor,
    };
  }

  /**
   * 获取Chat集成状态（支持多编辑器）
   */
  async getChatIntegrationStatus(): Promise<ChatIntegrationStatus | null> {
    const currentService = this.chatIntegrationFactory.getCurrentChatService();
    if (!currentService) {
      return null;
    }
    return await currentService.getIntegrationStatus();
  }

  /**
   * 清空所有数据（添加公共方法代替类型断言访问）
   */
  async clearAllData(): Promise<void> {
    await this.storageService.clearAll();
  }

  /**
   * 重新初始化默认数据（清空所有数据并重新创建默认数据）
   */
  async reinitializeDefaultData(): Promise<void> {
    try {
      // 显示确认对话框
      const confirmed = await this.uiService.showConfirmDialog(
        "确定要重新初始化默认数据吗？\n\n⚠️ 这将删除所有现有的 Prompt 和分类，并重新创建默认模板。\n\n此操作不可恢复！"
      );

      if (!confirmed) {
        return;
      }

      // 清空所有数据
      await this.storageService.clearAll();

      // 重新创建默认数据
      await this.ensureDefaultData();

      // 触发数据变更事件
      this._onDidPromptsChange.fire();

      await this.uiService.showInfo(
        `🎉 默认数据重新初始化完成！\n\n📊 已创建:\n• ${Object.keys(DEFAULT_CATEGORIES).length} 个默认分类\n• ${DEFAULT_PROMPTS.length
        } 个默认 Prompt 模板\n\n现在您可以看到所有最新的默认模板了。`
      );
    } catch (error) {
      console.error("重新初始化默认数据失败:", error);
      await this.uiService.showError("重新初始化失败");
    }
  }
}
