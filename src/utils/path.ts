/**
 * 将路径转换为使用正斜杠并移除首尾多余字符，统一跨平台处理。
 */
export function normalizePath(path: string): string {
	if (!path) {
		return "";
	}

	return path.replace(/\\/g, "/").trim().replace(/^\/*|\/*$/g, "");
}

