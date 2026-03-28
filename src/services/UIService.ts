import * as vscode from "vscode";
import { IUIService, PromptItem, PromptCategory, QuickPickPromptItem } from "../types";
import { UI_CONSTANTS, FILE_CONSTANTS, PERFORMANCE_CONSTANTS, getLocalizedFileFilter, generateUniqueId } from "../constants/constants";
import { t } from "./LocalizationService";
import { WebViewEditorService } from "./WebViewEditorService";

/**
 * 用户界面服务实现
 * 封装VSCode用户界面API，提供统一的UI操作接口
 */
export class UIService implements IUIService {
  private static instance: UIService;

  /**
   * 获取单例实例
   */
  static getInstance(): UIService {
    if (!UIService.instance) {
      UIService.instance = new UIService();
    }
    return UIService.instance;
  }

  private constructor() {
    // 私有构造函数，确保单例模式
  }

  /**
   * 显示Prompt选择列表
   * @param prompts Prompt数组
   * @returns 选中的Prompt，如果取消则返回undefined
   */
  async showPromptPicker(prompts: PromptItem[]): Promise<PromptItem | undefined> {
    if (!prompts || prompts.length === 0) {
      await this.showInfo(t("error.noPrompts"));
      return undefined;
    }

    try {
      // 转换为QuickPickItem格式
      const quickPickItems: QuickPickPromptItem[] = prompts
        .slice(0, PERFORMANCE_CONSTANTS.MAX_QUICK_PICK_ITEMS)
        .map((prompt) => ({
          label: `$(symbol-text) ${prompt.title}`,
          description: "",
          detail: this.formatPromptDetail(prompt),
          promptItem: prompt,
          picked: false,
        }));

      // 读取配置中的默认操作
      const config = vscode.workspace.getConfiguration("promptManager");
      const defaultAction = config.get<string>("defaultAction", "copy");
      const actionText = defaultAction === "chat" ? t("config.defaultAction.chat") : t("config.defaultAction.copy");

      // 创建QuickPick实例
      const quickPick = vscode.window.createQuickPick<QuickPickPromptItem>();
      quickPick.title = "Prompt Manager - " + t("ui.picker.selectPrompt");
      quickPick.placeholder = t("ui.quickPick.selectPrompt", actionText);
      quickPick.items = quickPickItems;
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;
      quickPick.canSelectMany = false;

      return new Promise<PromptItem | undefined>((resolve) => {
        let isShowingActionMenu = false;

        // 处理键盘事件
        quickPick.onDidTriggerButton(() => {
          // 可以在这里添加按钮相关的处理
        });

        quickPick.onDidAccept(() => {
          if (!isShowingActionMenu && quickPick.selectedItems.length > 0) {
            const selected = quickPick.selectedItems[0];
            quickPick.hide();
            resolve(selected.promptItem);
          }
        });

        quickPick.onDidHide(() => {
          if (!isShowingActionMenu) {
            quickPick.dispose();
            resolve(undefined);
          }
        });

        // 添加操作按钮
        quickPick.buttons = [
          {
            iconPath: new vscode.ThemeIcon("gear"),
            tooltip: t("ui.quickPick.actionMenu"),
          },
          {
            iconPath: new vscode.ThemeIcon("question"),
            tooltip: t("ui.quickPick.help"),
          },
        ];

        quickPick.onDidTriggerButton(async (button) => {
          const buttonIndex = quickPick.buttons.indexOf(button);

          if (buttonIndex === 0) {
            // 齿轮按钮 - 显示操作菜单
            if (quickPick.activeItems.length > 0) {
              isShowingActionMenu = true;
              const selected = quickPick.activeItems[0];
              quickPick.hide();

              setTimeout(async () => {
                try {
                  const action = await this.showPromptActionMenu(selected.promptItem);

                  if (action) {
                    // 导入PromptManager来处理操作
                    const { PromptManager } = await import("../models/PromptManager");
                    const promptManager = PromptManager.getInstance();

                    switch (action) {
                      case "edit":
                        const edited = await this.showPromptEditor(selected.promptItem);
                        if (edited) {
                          await promptManager.updatePrompt(edited);
                          await this.showInfo(t("message.saveSuccess"));
                        }
                        resolve(edited);
                        break;

                      case "delete":
                        const confirmed = await this.showConfirmDialog(t("confirm.deletePrompt"));
                        if (confirmed) {
                          await promptManager.deletePrompt(selected.promptItem.id);
                          await this.showInfo(t("message.deleteSuccess"));
                        }
                        resolve(undefined);
                        break;
                      default:
                        resolve(undefined);
                    }
                  } else {
                    resolve(undefined);
                  }
                } catch (error) {
                  console.error("操作菜单处理失败:", error);
                  resolve(undefined);
                }
              }, 100);
            } else {
              await this.showInfo(t("error.promptNotFound"));
            }
          } else if (buttonIndex === 1) {
            // 问号按钮 - 显示帮助
            await this.showInfo(t("ui.quickPick.helpText", actionText));
          }
        });

        quickPick.show();
      });
    } catch (error) {
      console.error("显示Prompt选择器失败:", error);
      await this.showError(t("error.showPromptsFailed"));
      return undefined;
    }
  }

  /**
   * 显示Prompt编辑界面（使用WebView编辑器）
   * @param prompt 要编辑的Prompt，如果为空则创建新的
   * @param context 扩展上下文
   * @returns 编辑后的Prompt，如果取消则返回undefined
   */
  async showPromptEditor(
    prompt?: PromptItem,
    context?: vscode.ExtensionContext,
    defaultCategoryId?: string
  ): Promise<PromptItem | undefined> {
    try {
      return await this.showWebViewEditor(prompt, context, defaultCategoryId);
    } catch (error) {
      console.error("显示Prompt编辑器失败:", error);
      await this.showError("显示编辑界面失败");
      return undefined;
    }
  }

  /**
   * 显示WebView编辑器
   * @param prompt 要编辑的Prompt，如果为空则创建新的
   * @param context 扩展上下文
   * @returns 编辑后的Prompt，如果取消则返回undefined
   */
  async showWebViewEditor(prompt?: PromptItem, context?: vscode.ExtensionContext, defaultCategoryId?: string): Promise<PromptItem | undefined> {
    try {
      const webViewEditorService = WebViewEditorService.getInstance();
      return await webViewEditorService.showEditor(prompt, context, defaultCategoryId);
    } catch (error) {
      console.error("显示WebView编辑器失败:", error);
      await this.showError("WebView编辑器启动失败");
      return undefined;
    }
  }

  /**
   * 显示分类选择列表
   * @param categories 分类数组
   * @returns 选中的分类，如果取消则返回undefined
   */
  async showCategoryPicker(categories: PromptCategory[]): Promise<PromptCategory | undefined> {
    if (!categories || categories.length === 0) {
      await this.showInfo(t("error.noCategories"));
      return undefined;
    }

    try {
      const items = categories.map((category) => ({
        label: `$(symbol-folder) ${category.name}`,
        description: category.description || "",
        detail: `创建于 ${category.createdAt?.toLocaleDateString() || "未知"}`,
        category: category,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        title: "Prompt Manager - " + t("ui.picker.selectCategory"),
        placeHolder: t("ui.picker.selectCategory"),
        matchOnDescription: true,
        matchOnDetail: true,
      });

      return (selected as any)?.category;
    } catch (error) {
      console.error("显示分类选择器失败:", error);
      await this.showError(t("error.noCategories"));
      return undefined;
    }
  }

  /**
   * 显示确认对话框
   * @param message 确认消息
   * @returns 是否确认
   */
  async showConfirmDialog(message: string): Promise<boolean> {
    try {
      const confirmButton = t("confirm.ok");
      const cancelButton = t("confirm.cancel");
      const selection = await vscode.window.showWarningMessage(message, { modal: true }, confirmButton, cancelButton);
      return selection === confirmButton;
    } catch (error) {
      console.error("显示确认对话框失败:", error);
      return false;
    }
  }

  /**
   * 显示信息提示
   * @param message 信息内容
   */
  async showInfo(message: string): Promise<void> {
    try {
      await vscode.window.showInformationMessage(message);
    } catch (error) {
      console.error("显示信息提示失败:", error);
    }
  }

  /**
   * 显示错误提示
   * @param message 错误信息
   */
  async showError(message: string): Promise<void> {
    try {
      await vscode.window.showErrorMessage(message);
    } catch (error) {
      console.error("显示错误提示失败:", error);
    }
  }

  /**
   * 显示文件保存对话框
   * @param defaultName 默认文件名
   * @returns 保存路径，如果取消则返回undefined
   */
  async showSaveDialog(defaultName?: string): Promise<string | undefined> {
    try {
      const uri = await vscode.window.showSaveDialog({
        defaultUri: defaultName
          ? vscode.Uri.file(defaultName + FILE_CONSTANTS.EXPORT_EXTENSION)
          : vscode.Uri.file(FILE_CONSTANTS.DEFAULT_EXPORT_NAME + FILE_CONSTANTS.EXPORT_EXTENSION),
        filters: getLocalizedFileFilter(t),
        saveLabel: t("management.export"),
      });

      return uri?.fsPath;
    } catch (error) {
      console.error("显示保存对话框失败:", error);
      await this.showError(t("error.saveFailed"));
      return undefined;
    }
  }

  /**
   * 显示文件打开对话框
   * @returns 文件路径，如果取消则返回undefined
   */
  async showOpenDialog(): Promise<string | undefined> {
    try {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: getLocalizedFileFilter(t),
        openLabel: t("management.import"),
      });

      return uris && uris.length > 0 ? uris[0].fsPath : undefined;
    } catch (error) {
      console.error("显示打开对话框失败:", error);
      await this.showError(t("error.loadFailed"));
      return undefined;
    }
  }

  /**
   * 显示多选Prompt列表
   * @param prompts Prompt数组
   * @returns 选中的Prompt数组，如果取消则返回undefined
   */
  async showMultiPromptPicker(prompts: PromptItem[]): Promise<PromptItem[] | undefined> {
    if (!prompts || prompts.length === 0) {
      await this.showInfo(t("error.noPrompts"));
      return undefined;
    }

    try {
      const quickPickItems: QuickPickPromptItem[] = prompts
        .slice(0, PERFORMANCE_CONSTANTS.MAX_QUICK_PICK_ITEMS)
        .map((prompt) => ({
          label: `$(symbol-text) ${prompt.title}`,
          description: "",
          detail: this.formatPromptDetail(prompt),
          promptItem: prompt,
          picked: false,
        }));

      const quickPick = vscode.window.createQuickPick<QuickPickPromptItem>();
      quickPick.title = "Prompt Manager - " + t("ui.picker.selectPrompt");
      quickPick.placeholder = t("ui.quickPick.placeholder");
      quickPick.items = quickPickItems;
      quickPick.canSelectMany = true;
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;

      return new Promise<PromptItem[] | undefined>((resolve) => {
        quickPick.onDidAccept(() => {
          const selected = quickPick.selectedItems.map((item) => item.promptItem);
          quickPick.hide();
          resolve(selected);
        });

        quickPick.onDidHide(() => {
          quickPick.dispose();
          resolve(undefined);
        });

        quickPick.show();
      });
    } catch (error) {
      console.error("显示多选Prompt列表失败:", error);
      await this.showError(t("error.showPromptsFailed"));
      return undefined;
    }
  }

  /**
   * 显示操作菜单
   * @param promptItem 目标Prompt
   * @returns 选中的操作
   */
  async showPromptActionMenu(promptItem: PromptItem): Promise<string | undefined> {
    try {
      const actions = [
        {
          label: "$(edit) " + t("action.edit"),
          description: t("action.edit"),
          action: "edit",
        },

        {
          label: "$(trash) " + t("action.delete"),
          description: t("action.delete"),
          action: "delete",
        },
      ];

      const selected = await vscode.window.showQuickPick(actions, {
        title: `${t("ui.picker.selectAction")}: ${promptItem.title}`,
        placeHolder: t("ui.picker.selectAction"),
      });

      return selected?.action;
    } catch (error) {
      console.error("显示操作菜单失败:", error);
      return undefined;
    }
  }

  /**
   * 显示分类编辑界面
   * @param category 要编辑的分类，如果为空则创建新的
   * @returns 编辑后的分类，如果取消则返回undefined
   */
  async showCategoryEditor(category?: PromptCategory): Promise<PromptCategory | undefined> {
    try {
      const isEditing = !!category;
      const title = isEditing ? t("ui.editor.editCategory", category.name) : t("ui.editor.createCategory");

      // 步骤1: 输入分类名称
      const categoryName = await vscode.window.showInputBox({
        title: title,
        prompt: t("ui.editor.categoryName"),
        placeHolder: t("ui.input.categoryPlaceholder"),
        value: category?.name || "",
        validateInput: (value) => {
          if (!value || value.trim() === "") {
            return t("error.categoryNameRequired");
          }
          if (value.length > 50) {
            return t("error.categoryNameTooLong");
          }
          return null;
        },
      });

      if (!categoryName) {
        return undefined;
      }

      // 步骤2: 输入分类描述
      const categoryDescription = await vscode.window.showInputBox({
        title: title,
        prompt: t("ui.editor.categoryDescription"),
        placeHolder: t("ui.input.descriptionPlaceholder"),
        value: category?.description || "",
      });

      if (categoryDescription === undefined) {
        return undefined;
      }

      // 步骤3: 选择图标
      const iconOptions = [
        // 基础分类图标
        { label: "📁 folder", description: "标准文件夹图标", icon: "folder" },
        { label: "📂 folder-opened", description: "打开的文件夹", icon: "folder-opened" },
        { label: "🗂️ folder-library", description: "资源库文件夹", icon: "folder-library" },

        // 功能性图标
        { label: "🔧 tools", description: "工具相关", icon: "tools" },
        { label: "📝 edit", description: "编辑相关", icon: "edit" },
        { label: "⚙️ gear", description: "设置配置", icon: "gear" },
        { label: "🎯 target", description: "目标导向", icon: "target" },
        { label: "💡 lightbulb", description: "创意灵感", icon: "lightbulb" },

        // 开发相关图标
        { label: "💻 code", description: "编程开发", icon: "code" },
        { label: "🐛 debug", description: "调试相关", icon: "debug" },
        { label: "🔍 search", description: "搜索查找", icon: "search" },
        { label: "🔗 link", description: "关联链接", icon: "link" },

        // 文档相关图标
        { label: "📄 file-text", description: "文本文档", icon: "file-text" },
        { label: "📊 graph", description: "图表数据", icon: "graph" },
        { label: "📚 book", description: "知识文档", icon: "book" },
        { label: "📋 checklist", description: "任务清单", icon: "checklist" },

        // 特殊用途图标
        { label: "⭐ star", description: "重要收藏", icon: "star" },
        { label: "🚀 rocket", description: "快速启动", icon: "rocket" },
        { label: "🏷️ tag", description: "标签分类", icon: "tag" },
        { label: "🎨 paintbrush", description: "创作设计", icon: "paintbrush" },
      ];

      const selectedIcon = await vscode.window.showQuickPick(iconOptions, {
        title: title,
        placeHolder: t("ui.editor.selectIcon"),
      });

      const icon = selectedIcon?.icon || category?.icon || "folder";

      // 构建结果
      const result: PromptCategory = {
        id: category?.id || this.generateId(),
        name: categoryName.trim(),
        description: categoryDescription.trim() || undefined,
        icon: icon,
        sortOrder: category?.sortOrder || 0,
        createdAt: category?.createdAt || new Date(),
      };

      return result;
    } catch (error) {
      console.error("显示分类编辑器失败:", error);
      await this.showError(t("error.editPromptFailed"));
      return undefined;
    }
  }

  /**
   * 显示分类操作菜单
   * @param category 分类对象
   * @returns 选中的操作，如果取消则返回undefined
   */
  async showCategoryActionMenu(category: PromptCategory): Promise<string | undefined> {
    try {
      const actions = [
        {
          label: "$(edit) " + t("action.editCategory"),
          description: t("action.editCategory"),
          action: "edit",
        },
        {
          label: "$(symbol-text) " + t("action.editCategory"),
          description: t("action.editCategory"),
          action: "rename",
        },
        {
          label: "$(export) " + t("action.exportCategory"),
          description: t("action.exportCategory"),
          action: "export",
        },
        {
          label: "$(trash) " + t("action.deleteCategory"),
          description: t("action.deleteCategory"),
          action: "delete",
        },
      ];

      const selected = await vscode.window.showQuickPick(actions, {
        title: `${t("ui.picker.selectAction")}: ${category.name}`,
        placeHolder: t("ui.picker.selectAction"),
      });

      return selected?.action;
    } catch (error) {
      console.error("显示分类操作菜单失败:", error);
      await this.showError(t("error.generic"));
      return undefined;
    }
  }

  // 私有方法

  /**
   * 格式化Prompt详情显示
   */
  private formatPromptDetail(prompt: PromptItem): string {
    const parts: string[] = [];

    if (prompt.categoryId) {
      parts.push(`📁 ${prompt.categoryId}`);
    } else {
      parts.push(`📁 ${t("category.uncategorized")}`);
    }

    if (prompt.tags && prompt.tags.length > 0) {
      parts.push(`🏷️ ${prompt.tags.join(", ")}`);
    }

    // parts.push(`🕒 ${prompt.createdAt?.toLocaleDateString() || "未知"}`);

    return parts.join(" | ");
  }

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return generateUniqueId('pm');
  }
}
