import { readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";

export interface LanguageStats {
  primary: string;
  breakdown: Record<string, { files: number; lines: number; percentage: number }>;
  frameworks: string[];
}

interface LanguageAccumulator {
  files: number;
  lines: number;
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ".c": "C",
  ".cc": "C++",
  ".cpp": "C++",
  ".cs": "C#",
  ".css": "CSS",
  ".go": "Go",
  ".h": "C",
  ".hpp": "C++",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".json": "JSON",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".md": "Markdown",
  ".php": "PHP",
  ".py": "Python",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".sh": "Shell",
  ".swift": "Swift",
  ".toml": "TOML",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".xml": "XML",
  ".yaml": "YAML",
  ".yml": "YAML",
};

const FRAMEWORK_BY_CONFIG: Record<string, string> = {
  "package.json": "Node",
  "Cargo.toml": "Rust",
  "go.mod": "Go",
  "pom.xml": "Java",
  "requirements.txt": "Python",
};

const BINARY_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".class",
  ".dll",
  ".dylib",
  ".exe",
  ".gif",
  ".ico",
  ".jar",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".so",
  ".webp",
  ".zip",
]);

const IGNORED_DIRECTORIES = new Set([".git", ".harris", "dist", "node_modules"]);

export async function detectLanguages(root: string): Promise<LanguageStats> {
  const accumulators = new Map<string, LanguageAccumulator>();
  const frameworks = new Set<string>();

  await walk(root, async (filePath, fileName) => {
    const framework = FRAMEWORK_BY_CONFIG[fileName];
    if (framework) {
      frameworks.add(framework);
    }

    const extension = extname(fileName);
    const language = LANGUAGE_BY_EXTENSION[extension];
    if (!language || BINARY_EXTENSIONS.has(extension)) {
      return;
    }

    const content = await readTextFile(filePath);
    if (content === undefined) {
      return;
    }

    const current = accumulators.get(language) ?? { files: 0, lines: 0 };
    current.files++;
    current.lines += countLines(content);
    accumulators.set(language, current);
  });

  const breakdown = buildBreakdown(accumulators);
  const primary = selectPrimaryLanguage(accumulators);

  return {
    primary,
    breakdown,
    frameworks: [...frameworks].sort(),
  };
}

async function walk(root: string, onFile: (filePath: string, fileName: string) => Promise<void>): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name)) {
        continue;
      }
      await walk(join(root, entry.name), onFile);
    } else if (entry.isFile()) {
      await onFile(join(root, entry.name), entry.name);
    }
  }
}

async function readTextFile(filePath: string): Promise<string | undefined> {
  const buffer = await readFile(filePath);
  if (isBinary(buffer)) {
    return undefined;
  }
  return buffer.toString("utf-8");
}

function isBinary(buffer: Buffer): boolean {
  const bytesToScan = Math.min(buffer.length, 8000);
  for (let index = 0; index < bytesToScan; index++) {
    if (buffer[index] === 0) {
      return true;
    }
  }
  return false;
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  const newlines = content.match(/\n/g)?.length ?? 0;
  return content.endsWith("\n") ? newlines : newlines + 1;
}

function buildBreakdown(
  accumulators: Map<string, LanguageAccumulator>,
): Record<string, { files: number; lines: number; percentage: number }> {
  const totalLines = [...accumulators.values()].reduce((sum, entry) => sum + entry.lines, 0);
  const entries = [...accumulators.entries()].sort(([left], [right]) => left.localeCompare(right));
  const breakdown: Record<string, { files: number; lines: number; percentage: number }> = {};
  let remainingPercentage = totalLines > 0 ? 100 : 0;

  entries.forEach(([language, stats], index) => {
    const isLast = index === entries.length - 1;
    const percentage = totalLines > 0 ? (isLast ? remainingPercentage : round2((stats.lines / totalLines) * 100)) : 0;
    remainingPercentage = round2(remainingPercentage - percentage);
    breakdown[language] = {
      files: stats.files,
      lines: stats.lines,
      percentage,
    };
  });

  return breakdown;
}

function selectPrimaryLanguage(accumulators: Map<string, LanguageAccumulator>): string {
  let primary = "Unknown";
  let primaryStats: LanguageAccumulator | undefined;

  for (const [language, stats] of accumulators) {
    if (
      !primaryStats ||
      stats.lines > primaryStats.lines ||
      (stats.lines === primaryStats.lines && stats.files > primaryStats.files) ||
      (stats.lines === primaryStats.lines && stats.files === primaryStats.files && language.localeCompare(primary) < 0)
    ) {
      primary = language;
      primaryStats = stats;
    }
  }

  return primary;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
