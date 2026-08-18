import type { NodeType } from "busabase-contract/domains";
import { getNodeType } from "busabase-contract/domains";
import {
  AppWindow,
  Bot,
  CodeXml,
  File,
  FileText,
  Folder,
  Form,
  HardDrive,
  PenTool,
  Sparkles,
  Table2,
  Workflow,
} from "lucide-react-native";

// Maps the node-type registry's platform-neutral icon ids onto lucide-react-native
// icons. The registry stays the single source of truth for which icon a node type
// gets; this table only says what that id looks like on React Native.
const NODE_ICONS: Record<string, typeof Folder> = {
  folder: Folder,
  table: Table2,
  sparkles: Sparkles,
  "file-text": FileText,
  bot: Bot,
  "hard-drive": HardDrive,
  "app-window": AppWindow,
  // The remaining registry icon ids. Without these the types they belong to
  // (File, Whiteboard, Workflow, HTML) all fell through to the FileText
  // fallback and looked identical in the tree and the create sheet.
  file: File,
  form: Form,
  "pen-tool": PenTool,
  workflow: Workflow,
  "code-xml": CodeXml,
};

export const nodeIconForType = (type: NodeType | string): typeof Folder =>
  NODE_ICONS[getNodeType(type)?.icon ?? ""] ?? FileText;
