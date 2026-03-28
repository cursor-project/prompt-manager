import * as vscode from "vscode";
import {
  PromptItem,
  PromptCategory,
  TreePromptItem,
  IPromptTreeDataProvider,
  TreeCategoryItem,
  TreePromptItemData,
} from "../types";
import { StorageService } from "../services/StorageService";
import { TREE_CONTEXT_VALUES, TREE_ICONS, TREE_SPECIAL_CATEGORIES, COMMANDS } from "../constants/constants";

/**
 * Prompt TreeView数据提供器
 * 实现VS Code TreeDataProvider接口，为侧边栏提供树形结构数据
 */
export class PromptTreeDataProvider implements IPromptTreeDataProvider {
  private _onDidChangeTreeData: vscode.EventEmitter<TreePromptItem | undefined | null | void> = new vscode.EventEmitter<
    TreePromptItem | undefined | null | void
  >();
  readonly onDidChangeTreeData: vscode.Event<TreePromptItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private storageService: StorageService;
  private treeData: TreePromptItem[] = [];
  private searchFilter: string | null = null;
  private searchTimeout: NodeJS.Timeout | null = null;
  private refreshTimeout: NodeJS.Timeout | null = null;

  constructor(storageService: StorageService) {
    this.storageService = storageService;
  }

  /**
   * 获取TreeView项目
   * @param element TreeView项目，如果为undefined则返回根级项目
   * @returns 树形项目或Promise
   */
  getTreeItem(element: TreePromptItem): vscode.TreeItem | Thenable<vscode.TreeItem> {
    const treeItem = new vscode.TreeItem(element.label, element.collapsibleState);

    treeItem.id = element.id;
    treeItem.contextValue = element.contextValue;
    treeItem.iconPath = element.iconPath;
    treeItem.command = element.command;
    treeItem.tooltip = this.createTooltip(element);
    // 设置resourceId用于菜单条件判断
    (treeItem as any).resourceUri = vscode.Uri.parse(`prompt-manager:///${element.id}`);

    return treeItem;
  }

  /**
   * 获取子项目
   * @param element 父级项目，如果为undefined则返回根级项目
   * @returns 子项目数组或Promise
   */
  getChildren(element?: TreePromptItem): Thenable<TreePromptItem[]> {
    if (!element) {
      // 返回根级项目
      return this.getRootItems();
    } else {
      // 返回指定项目的子项目
      return this.getChildItems(element);
    }
  }

  /**
   * 获取父级项目
   * @param element 子项目
   * @returns 父级项目或undefined
   */
  getParent(element: TreePromptItem): vscode.ProviderResult<TreePromptItem> {
    if (element.parentId) {
      return this.findItemById(element.parentId);
    }
    return undefined;
  }

  /**
   * 刷新整个TreeView（带防抖机制）
   */
  refresh(): void {
    // 清除之前的防抖定时器
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
    }

    // 设置新的防抖定时器
    this.refreshTimeout = setTimeout(() => {
      this._onDidChangeTreeData.fire();
    }, 100); // 100ms防抖延迟
  }

  /**
   * 刷新特定项目
   * @param item 要刷新的项目
   */
  refreshItem(item: TreePromptItem): void {
    this._onDidChangeTreeData.fire(item);
  }

  /**
   * 设置搜索过滤器
   * @param filter 搜索关键词，null表示清除搜索
   */
  setSearchFilter(filter: string | null): void {
    this.searchFilter = filter; // 立即更新值，确保 getSearchFilter() 返回最新值

    // 清除之前的防抖定时器
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
    }

    // 仅对 refresh 进行防抖
    this.searchTimeout = setTimeout(() => {
      this.refresh();
    }, 300); // 300ms防抖延迟
  }

  /**
   * 获取当前搜索过滤器
   * @returns 当前搜索关键词
   */
  getSearchFilter(): string | null {
    return this.searchFilter;
  }

  /**
   * 获取根级项目
   * @returns 根级项目数组
   */
  private async getRootItems(): Promise<TreePromptItem[]> {
    try {
      // 如果有搜索过滤器，返回搜索结果
      if (this.searchFilter && this.searchFilter.trim()) {
        return await this.getSearchResults();
      }

      const [prompts, categories] = await Promise.all([
        this.storageService.getPrompts(),
        this.storageService.getCategories(),
      ]);

      const rootItems: TreePromptItem[] = [];

      // 2. 添加普通分类
      for (const category of categories) {
        const categoryPromptCount = await this.getCategoryPromptCount(category.id, prompts);
        rootItems.push(this.createCategoryItem(category, categoryPromptCount));
      }

      // 3. 添加未分类的prompt
      const uncategorizedPrompts = prompts.filter(
        (p) => !p.categoryId || !categories.some((c) => c.id === p.categoryId)
      );
      if (uncategorizedPrompts.length > 0) {
        rootItems.push(this.createUncategorizedCategory(uncategorizedPrompts.length));
      }

      this.treeData = rootItems;
      return rootItems;
    } catch (error) {
      console.error("获取TreeView根项目失败:", error);
      return [];
    }
  }

  /**
   * 获取指定分类下的Prompt数量
   * @param categoryId 分类ID
   * @param prompts 可选的prompts数组，避免重复查询
   * @returns Prompt数量
   */
  private async getCategoryPromptCount(categoryId: string, prompts?: PromptItem[]): Promise<number> {
    try {
      if (!prompts) {
        prompts = await this.storageService.getPrompts();
      }
      return prompts.filter((p) => p.categoryId === categoryId).length;
    } catch (error) {
      console.error("获取分类Prompt数量失败:", error);
      return 0;
    }
  }

  /**
   * 获取指定项目的子项目
   * @param element 父级项目
   * @returns 子项目数组
   */
  private async getChildItems(element: TreePromptItem): Promise<TreePromptItem[]> {
    try {
      const prompts = await this.storageService.getPrompts();

      if (element.contextValue === TREE_CONTEXT_VALUES.CATEGORY_ITEM) {
        // 分类项目的子项目是该分类下的所有prompt
        if (element.id === TREE_SPECIAL_CATEGORIES.UNCATEGORIZED) {
          // 未分类
          const categories = await this.storageService.getCategories();
          const uncategorizedPrompts = prompts.filter(
            (p) => !p.categoryId || !categories.some((c) => c.id === p.categoryId)
          );
          return uncategorizedPrompts.map((p) => this.createPromptItem(p, element.id));
        } else {
          // 普通分类
          const categoryPrompts = prompts.filter((p) => p.categoryId === element.id);
          return categoryPrompts.map((p) => this.createPromptItem(p, element.id));
        }
      }

      return [];
    } catch (error) {
      console.error("获取TreeView子项目失败:", error);
      return [];
    }
  }

  /**
   * 创建未分类项目
   * @param promptCount Prompt数量
   * @returns 未分类TreeItem
   */
  private createUncategorizedCategory(promptCount: number = 0): TreeCategoryItem {
    return {
      id: TREE_SPECIAL_CATEGORIES.UNCATEGORIZED,
      label: `未分类 (${promptCount})`,
      description: "",
      contextValue: TREE_CONTEXT_VALUES.CATEGORY_ITEM,
      iconPath: new vscode.ThemeIcon(TREE_ICONS.CATEGORY),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      categoryData: {
        id: TREE_SPECIAL_CATEGORIES.UNCATEGORIZED,
        name: "未分类",
        description: "未分类的Prompt",
        icon: TREE_ICONS.CATEGORY,
        sortOrder: 999,
      },
    };
  }

  /**
   * 创建分类项目
   * @param category 分类数据
   * @param promptCount Prompt数量
   * @returns 分类TreeItem
   */
  private createCategoryItem(category: PromptCategory, promptCount: number = 0): TreeCategoryItem {
    const icon = category.icon || TREE_ICONS.CATEGORY;
    return {
      id: category.id,
      label: `${category.name} (${promptCount})`,
      description: category.description,
      contextValue: TREE_CONTEXT_VALUES.CATEGORY_ITEM,
      iconPath: new vscode.ThemeIcon(icon),
      collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
      categoryData: category,
      sortOrder: category.sortOrder,
    };
  }

  /**
   * 创建Prompt项目
   * @param prompt Prompt数据
   * @param parentId 父级ID
   * @returns Prompt TreeItem
   */
  private createPromptItem(prompt: PromptItem, parentId?: string): TreePromptItemData {
    const icon = TREE_ICONS.PROMPT;
    const label = prompt.title;

    return {
      id: prompt.id,
      label: label,
      contextValue: TREE_CONTEXT_VALUES.PROMPT_ITEM,
      iconPath: new vscode.ThemeIcon(icon),
      collapsibleState: vscode.TreeItemCollapsibleState.None,
      command: {
        command: COMMANDS.SEND_TO_CHAT_FROM_TREE,
        title: "发送到Chat",
        arguments: [{ promptData: prompt }],
      },
      promptData: prompt,
      parentId: parentId,
    };
  }

  /**
   * 创建工具提示文本
   * @param element TreeView项目
   * @returns 工具提示文本
   */
  private createTooltip(element: TreePromptItem): string {
    if (element.contextValue === TREE_CONTEXT_VALUES.PROMPT_ITEM && element.promptData) {
      const prompt = element.promptData;
      const lines = [
        "",
        `分类: ${prompt.categoryId || "未分类"}`,
        `标签: ${prompt.tags?.join(", ") || "无"}`,
        "",
      ];
      return lines.join("\n");
    } else if (element.contextValue === TREE_CONTEXT_VALUES.CATEGORY_ITEM && element.categoryData) {
      const category = element.categoryData;
      return `${category.name}\n${category.description || ""}\n\n点击展开查看Prompt`;
    }

    return element.label;
  }

  /**
   * 根据ID查找TreeView项目
   * @param id 项目ID
   * @returns TreeView项目或undefined
   */
  private findItemById(id: string): TreePromptItem | undefined {
    const findInArray = (items: TreePromptItem[]): TreePromptItem | undefined => {
      for (const item of items) {
        if (item.id === id) {
          return item;
        }
        // 如果是分类项目，可能还需要搜索其子项目
        // 这里简化处理，实际使用中可能需要递归搜索
      }
      return undefined;
    };

    return findInArray(this.treeData);
  }

  /**
   * 根据Prompt ID获取TreeView项目
   * @param promptId Prompt ID
   * @returns TreeView项目或undefined
   */
  async findPromptTreeItem(promptId: string): Promise<TreePromptItem | undefined> {
    // 刷新数据确保最新
    await this.getRootItems();

    // 遍历所有分类查找对应的prompt
    for (const categoryItem of this.treeData) {
      if (categoryItem.contextValue === TREE_CONTEXT_VALUES.CATEGORY_ITEM) {
        const children = await this.getChildItems(categoryItem);
        const found = children.find(
          (child) => child.contextValue === TREE_CONTEXT_VALUES.PROMPT_ITEM && child.promptData?.id === promptId
        );
        if (found) {
          return found;
        }
      }
    }

    return undefined;
  }

  /**
   * 获取搜索结果
   * @returns 搜索结果项目数组
   */
  private async getSearchResults(): Promise<TreePromptItem[]> {
    try {
      if (!this.searchFilter) {
        return [];
      }

      const [prompts, categories] = await Promise.all([
        this.storageService.getPrompts(),
        this.storageService.getCategories(),
      ]);

      const searchTerm = this.searchFilter.toLowerCase().trim();
      const matchedPrompts: PromptItem[] = [];

      // 搜索Prompt
      for (const prompt of prompts) {
        let isMatch = false;

        // 搜索标题
        if (prompt.title.toLowerCase().includes(searchTerm)) {
          isMatch = true;
        }
        // 搜索标签
        else if (prompt.tags?.some((tag) => tag.toLowerCase().includes(searchTerm))) {
          isMatch = true;
        }
        // 搜索内容
        else if (prompt.content.toLowerCase().includes(searchTerm)) {
          isMatch = true;
        }

        if (isMatch) {
          matchedPrompts.push(prompt);
        }
      }

      // 搜索分类名称
      const matchedCategoryIds: string[] = [];
      for (const category of categories) {
        if (category.name.toLowerCase().includes(searchTerm)) {
          matchedCategoryIds.push(category.id);
        }
      }

      // 添加匹配分类下的所有Prompt
      for (const categoryId of matchedCategoryIds) {
        const categoryPrompts = prompts.filter((p) => p.categoryId === categoryId);
        for (const prompt of categoryPrompts) {
          if (!matchedPrompts.some((mp) => mp.id === prompt.id)) {
            matchedPrompts.push(prompt);
          }
        }
      }

      // 按相关度排序
      matchedPrompts.sort((a, b) => {
        // 标题匹配优先于其他字段匹配
        const aInTitle = a.title.toLowerCase().includes(searchTerm);
        const bInTitle = b.title.toLowerCase().includes(searchTerm);
        if (aInTitle !== bInTitle) {
          return aInTitle ? -1 : 1;
        }
        // 按字母顺序排序
        return a.title.localeCompare(b.title);
      });

      // 转换为TreeItem，显示分类信息
      const searchResults: TreePromptItem[] = [];
      for (const prompt of matchedPrompts) {
        const category = categories.find((c) => c.id === prompt.categoryId);
        const categoryName = category ? category.name : "未分类";

        const item = this.createPromptItem(prompt);

        searchResults.push(item);
      }

      return searchResults;
    } catch (error) {
      console.error("获取搜索结果失败:", error);
      return [];
    }
  }
}
