import * as vscode from "vscode";
import {
  IChatIntegrationService,
  ChatIntegrationOptions,
  ChatIntegrationStatus,
} from "./interfaces/IChatIntegrationService";
import { EditorEnvironmentDetector } from "./EditorEnvironmentDetector";
import { EditorEnvironmentType } from "./interfaces/IEditorEnvironmentDetector";

/**
 * VSCode Chat集成服务
 * 负责与VSCode Copilot Chat窗口的通信
 * 支持多种集成方式：命令调用、剪贴板注入等
 */
export class VSCodeIntegrationService implements IChatIntegrationService {
  private static instance: VSCodeIntegrationService;
  private readonly environmentDetector: EditorEnvironmentDetector;

  private constructor() {
    this.environmentDetector = EditorEnvironmentDetector.getInstance();
  }

  public static getInstance(): VSCodeIntegrationService {
    if (!VSCodeIntegrationService.instance) {
      VSCodeIntegrationService.instance = new VSCodeIntegrationService();
    }
    return VSCodeIntegrationService.instance;
  }

  /**
   * 检测是否运行在VSCode环境中
   */
  public isEditorEnvironment(): boolean {
    return this.environmentDetector.isEnvironment(EditorEnvironmentType.VSCODE);
  }

  /**
   * 发送prompt到VSCode Chat窗口
   * @param options Chat集成选项
   * @returns 是否发送成功
   */
  public async sendToChat(options: ChatIntegrationOptions): Promise<boolean> {
    if (!this.isEditorEnvironment()) {
      console.warn("当前不在VSCode环境中，无法发送到Chat窗口");
      return false;
    }

    try {
      const formattedPrompt = this.formatPromptForVSCode(options);

      const hasChat = await this.isChatCommandAvailable();
      if (!hasChat) {
        return await this.tryClipboardMethod(formattedPrompt, { copilotMissing: true });
      }

      const success = await this.tryMultipleIntegrationMethods(formattedPrompt);

      return success;
    } catch (error) {
      console.error("发送到VSCode Chat失败:", error);
      return false;
    }
  }

  /**
   * 检查Chat命令是否可用
   * @returns Chat命令可用性
   */
  public async isChatCommandAvailable(): Promise<boolean> {
    try {
      // 检查常见的VSCode Chat相关命令
      const commands = await vscode.commands.getCommands();
      const chatCommands = [
        "github.copilot.interactiveEditor.explain",
        "github.copilot.sendChatToTerminal",
      ];

      return chatCommands.some((cmd) => commands.includes(cmd));
    } catch (error) {
      console.error("检查VSCode Chat命令可用性失败:", error);
      return false;
    }
  }

  /**
   * 获取集成状态
   * @returns 当前集成状态信息
   */
  public async getIntegrationStatus(): Promise<ChatIntegrationStatus> {
    return {
      isEditorEnvironment: this.isEditorEnvironment(),
      isCommandAvailable: await this.isChatCommandAvailable(),
      hasActiveEditor: !!vscode.window.activeTextEditor,
    };
  }

  /**
   * 获取编辑器类型标识
   * @returns 编辑器类型字符串
   */
  public getEditorType(): string {
    return "vscode";
  }

  /**
   * 尝试多种集成方式发送prompt
   * @param prompt 格式化后的prompt
   * @returns 是否发送成功
   */
  private async tryMultipleIntegrationMethods(prompt: string): Promise<boolean> {
    // 方法1：尝试使用Copilot Chat命令
    if (await this.tryCopilotChatCommand(prompt)) {
      return true;
    }

    // 方法2：尝试使用通用Chat命令
    if (await this.tryGenericChatCommand(prompt)) {
      return true;
    }

    // 方法3：使用剪贴板+快捷键方式
    if (await this.tryClipboardMethod(prompt)) {
      return true;
    }

    return false;
  }

  /**
   * 尝试使用Copilot Chat命令
   * @param prompt 格式化的prompt
   * @returns 是否成功
   */
  private async tryCopilotChatCommand(prompt: string): Promise<boolean> {
    try {
      // 先将prompt复制到剪贴板
      await vscode.env.clipboard.writeText(prompt);

      // 尝试使用github.copilot相关命令
      try {
        await vscode.commands.executeCommand("github.copilot.interactiveEditor.explain");
      } catch (error) {
        // 如果copilot命令不可用，直接返回false
        console.warn("Copilot命令不可用:", error);
        return false;
      }

      // 短暂延迟后尝试粘贴
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 执行粘贴命令
      await vscode.commands.executeCommand("editor.action.clipboardPasteAction");

      return true;
    } catch (error) {
      console.warn("Copilot Chat命令方式失败:", error);
      return false;
    }
  }

  /**
   * 尝试使用通用Chat命令
   * @param prompt 格式化的prompt
   * @returns 是否成功
   */
  private async tryGenericChatCommand(prompt: string): Promise<boolean> {
    try {
      await vscode.env.clipboard.writeText(prompt);

      // 由于通用chat命令不可用，直接返回false让程序使用剪贴板方式
      console.warn("通用Chat命令在当前环境中不可用");
      return false;
    } catch (error) {
      console.warn("通用Chat命令方式失败:", error);
      return false;
    }
  }

  /**
   * 使用剪贴板方式
   * @param prompt 格式化的prompt
   * @returns 是否成功
   */
  private async tryClipboardMethod(prompt: string, opts?: { copilotMissing?: boolean }): Promise<boolean> {
    try {
      await vscode.env.clipboard.writeText(prompt);

      // 显示提示信息（根据是否缺少 Copilot 给出更友好的文案）
      const message = opts?.copilotMissing
        ? "未检测到 GitHub Copilot Chat 插件。已将 Prompt 复制到剪贴板，请手动打开 Chat 窗口并粘贴使用。"
        : "Prompt已复制到剪贴板。请手动打开Chat窗口并粘贴使用。";

      const action = await vscode.window.showInformationMessage(message, "确定");

      return !!action;
    } catch (error) {
      console.error("剪贴板方式失败:", error);
      return false;
    }
  }

  /**
   * 格式化prompt用于VSCode处理
   * @param options 格式化选项
   * @returns 格式化后的prompt内容
   */
  private formatPromptForVSCode(options: ChatIntegrationOptions): string {
    let content = options.prompt;

    // 如果需要包含标题
    if (options.includeTitle && options.title) {
      content = `# ${options.title}\n\n${content}`;
    }

    // 不再添加上下文信息（功能已移除）
    // 保持原有的prompt内容

    return content;
  }

  /**
   * 生成当前编辑器的上下文信息
   * @returns 上下文信息字符串
   */
  private generateEditorContext(): string | null {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        return null;
      }

      const document = editor.document;
      const selection = editor.selection;

      let contextInfo = `\n--- 当前上下文信息 ---\n`;
      contextInfo += `文件: ${document.fileName}\n`;
      contextInfo += `语言: ${document.languageId}\n`;

      if (!selection.isEmpty) {
        const selectedText = document.getText(selection);
        contextInfo += `选中文本:\n\`\`\`${document.languageId}\n${selectedText}\n\`\`\`\n`;
      }

      contextInfo += `行号: ${selection.active.line + 1}\n`;
      contextInfo += `--- 上下文信息结束 ---`;

      return contextInfo;
    } catch (error) {
      console.error("生成编辑器上下文失败:", error);
      return null;
    }
  }
}
