#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
代码打包工具 - 将 *.ts, *.css, *.json 文件打包成 XML 格式
"""

import argparse
import os
from datetime import datetime
from pathlib import Path

import xml.etree.ElementTree as ET
from xml.dom import minidom

TEST_FILE_SUFFIXES = (
    '.test.ts',
    '.spec.ts',
    '.test.tsx',
    '.spec.tsx',
    '.test.js',
    '.spec.js',
    '.test.jsx',
    '.spec.jsx',
    '.mock.ts',
    '.mock.tsx',
    '.mock.js',
    '.mock.jsx',
)

TEST_DIR_NAMES = {'__tests__', 'tests', '__mocks__'}

CONFIG_FILE_NAMES = {
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.base.json',
    'tsconfig.build.json',
    'jest.config.js',
    'jest.config.ts',
    'eslint.config.js',
    'eslint.config.ts',
    'esbuild.config.mjs',
    'codebase.xml',
    'versions.json',
}

CONFIG_SUFFIXES = (
    '.config.js',
    '.config.ts',
    '.config.mjs',
    '.config.cjs',
    '.config.json',
)

DEFAULT_IGNORE_PATTERNS = [
    '__pycache__',
    '.pyc',
    'dist',
    'build',
    '.obsidian',
    '.claude',
    '.vscode',
]


def escape_content(content):
    """
    转义特殊字符以便安全地嵌入XML
    """
    return content


def should_ignore(file_path, ignore_patterns):
    """
    检查文件是否应该被忽略
    """
    path_str = str(file_path)
    for pattern in ignore_patterns:
        if pattern in path_str:
            return True
    return False


def is_test_file(file_path: Path) -> bool:
    """
    判断文件是否属于测试或模拟文件
    """
    name_lower = file_path.name.lower()
    if any(name_lower.endswith(suffix) for suffix in TEST_FILE_SUFFIXES):
        return True
    return any(part.lower() in TEST_DIR_NAMES for part in file_path.parts)


def is_config_file(file_path: Path) -> bool:
    """
    判断文件是否属于构建或工具配置文件
    """
    name_lower = file_path.name.lower()
    if name_lower in CONFIG_FILE_NAMES:
        return True
    if name_lower.startswith('tsconfig') and name_lower.endswith('.json'):
        return True
    return any(name_lower.endswith(suffix) for suffix in CONFIG_SUFFIXES)


def collect_files(root_dir, extensions, ignore_patterns, include_tests=False, include_config=False):
    """
    收集指定扩展名的文件

    Args:
        root_dir: 根目录路径
        extensions: 文件扩展名列表,如 ['.ts', '.css', '.json']
        ignore_patterns: 要忽略的路径模式列表
        include_tests: 是否包含测试或模拟文件
        include_config: 是否包含构建和工具配置文件

    Returns:
        文件路径列表
    """
    files = []
    root_path = Path(root_dir)

    for ext in extensions:
        for file_path in root_path.rglob(f'*{ext}'):
            if file_path.is_file() and not should_ignore(file_path, ignore_patterns):
                if not include_tests and is_test_file(file_path):
                    continue
                if not include_config and is_config_file(file_path):
                    continue
                files.append(file_path)

    return sorted(files)


def create_xml_structure(files, root_dir):
    """
    创建XML结构

    Args:
        files: 文件路径列表
        root_dir: 根目录路径

    Returns:
        XML根元素
    """
    root = ET.Element('codebase')
    root.set('project', os.path.basename(root_dir))
    root.set('timestamp', datetime.now().isoformat())

    # 添加元数据
    metadata = ET.SubElement(root, 'metadata')
    ET.SubElement(metadata, 'total_files').text = str(len(files))
    ET.SubElement(metadata, 'root_directory').text = str(root_dir)

    # 添加文件内容
    files_element = ET.SubElement(root, 'files')

    for file_path in files:
        try:
            # 读取文件内容
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # 创建文件元素
            file_element = ET.SubElement(files_element, 'file')
            relative_path = file_path.relative_to(root_dir)
            file_element.set('path', str(relative_path))
            file_element.set('extension', file_path.suffix)
            file_element.set('size', str(len(content)))

            # 添加文件内容(使用CDATA包裹以保持原始格式)
            content_element = ET.SubElement(file_element, 'content')
            content_element.text = content

            print(f"✓ 已添加: {relative_path}")

        except Exception as e:
            print(f"✗ 错误: 无法读取 {file_path}: {e}")

    return root


def prettify_xml(elem):
    """
    美化XML输出
    """
    rough_string = ET.tostring(elem, encoding='utf-8')
    reparsed = minidom.parseString(rough_string)
    return reparsed.toprettyxml(indent="  ", encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(
        description='将TypeScript、CSS、JSON文件打包成XML格式',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例用法:
  python pack_code_to_xml.py
  python pack_code_to_xml.py -o output.xml
  python pack_code_to_xml.py -d /path/to/project -o packed.xml
  python pack_code_to_xml.py --include-node-modules
        """
    )

    parser.add_argument(
        '-d', '--directory',
        default='.',
        help='要扫描的根目录 (默认: 当前目录)'
    )

    parser.add_argument(
        '-o', '--output',
        default='codebase.xml',
        help='输出XML文件名 (默认: codebase.xml)'
    )

    parser.add_argument(
        '-e', '--extensions',
        nargs='+',
        default=['.ts', '.css', '.json'],
        help='要包含的文件扩展名 (默认: .ts .css .json)'
    )

    parser.add_argument(
        '--include-node-modules',
        action='store_true',
        help='包含 node_modules 目录 (默认忽略)'
    )

    parser.add_argument(
        '--include-git',
        action='store_true',
        help='包含 .git 目录 (默认忽略)'
    )

    parser.add_argument(
        '--include-tests',
        action='store_true',
        help='包含测试与模拟文件 (默认忽略)'
    )

    parser.add_argument(
        '--include-config',
        action='store_true',
        help='包含构建和工具配置文件 (默认忽略)'
    )

    parser.add_argument(
        '--ignore',
        nargs='+',
        default=[],
        metavar='PATTERN',
        help='追加忽略模式 (基于子串匹配)'
    )

    args = parser.parse_args()

    # 设置忽略模式
    ignore_patterns = list(DEFAULT_IGNORE_PATTERNS)
    if not args.include_node_modules:
        ignore_patterns.append('node_modules')
    if not args.include_git:
        ignore_patterns.append('.git')
    if args.ignore:
        ignore_patterns.extend(args.ignore)

    print(f"📦 开始打包代码...")
    print(f"📂 扫描目录: {os.path.abspath(args.directory)}")
    print(f"📄 文件类型: {', '.join(args.extensions)}")
    print(f"🚫 忽略模式: {', '.join(ignore_patterns)}")
    print(f"🧪 包含测试文件: {'是' if args.include_tests else '否'}")
    print(f"🛠️ 包含配置文件: {'是' if args.include_config else '否'}")
    print()

    # 收集文件
    files = collect_files(
        args.directory,
        args.extensions,
        ignore_patterns,
        include_tests=args.include_tests,
        include_config=args.include_config,
    )

    if not files:
        print("⚠️  没有找到匹配的文件!")
        return

    print(f"\n找到 {len(files)} 个文件\n")

    # 创建XML结构
    root = create_xml_structure(files, args.directory)

    # 写入文件
    xml_content = prettify_xml(root)
    output_path = Path(args.output)

    with open(output_path, 'wb') as f:
        f.write(xml_content)

    print(f"\n✅ 打包完成!")
    print(f"📦 输出文件: {output_path.absolute()}")
    print(f"📊 文件大小: {output_path.stat().st_size / 1024:.2f} KB")


if __name__ == '__main__':
    main()
