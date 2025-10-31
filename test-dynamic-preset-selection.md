# 测试动态预设选择功能

## 测试用例

### 1. 无配置预设的模板

这个模板没有配置 `fast-templater-config`，应该触发动态预设选择：

```markdown
---
title: 无预设配置的模板
tags: [test]
---

# 项目报告模板

## 基本信息
- 项目名称：{{project_name}}
- 创建日期：{{created_date}}
- 负责人：{{manager}}
- 状态：{{status}}

## 项目描述
{{description}}
```

### 2. 有配置预设的模板（向后兼容性测试）

这个模板配置了预设 `project-template`，应该直接使用预设：

```markdown
---
title: 项目模板
fast-templater-config: project-template
tags: [template]
---

# 项目文档

## 项目信息
- 项目ID：{{project_id}}
- 项��名称：{{project_name}}
- 开始日期：{{start_date}}
- 预计完成：{{end_date}}
```

### 3. 配置了不存在预设的模板

这个模板配置了不存在的预设 `non-existent-preset`，应该回退到动态选择：

```markdown
---
title: 坏预设模板
fast-templater-config: non-existent-preset
tags: [test]
---

# 失败的模板

这里应该会显示预设不存在的警告，然后打开动态选择界面。
```

## 预期行为

1. **无配置模板**：打开动态预设选择界面，显示智能推荐
2. **有有效预设**：直接使用配置的预设，向后兼容
3. **有无效预设**：显示警告，然后打开动态预设选择界面
4. **无可用预设**：直接插入模板，不使用预设

## 测试步骤

1. 创建上述三个测试模板文件
2. 确保有一些可用的预设
3. 依次测试每个模板的行为
4. 验证智能匹配功能是否正常工作
5. 测试搜索和过滤功能