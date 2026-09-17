import { registerNodeDetail } from "../../dashboard/node-detail-registry";
import { registerSidePanelTab } from "../../dashboard/side-panel-registry";
import { WorkflowDetailView, WorkflowSidePanelPreview } from "./graph-detail-view";
import { HtmlDetailView, HtmlSidePanelPreview } from "./html-detail-view";
import { WhiteboardDetailView, WhiteboardSidePanelPreview } from "./whiteboard-detail-view";

registerNodeDetail("whiteboard", WhiteboardDetailView);
registerNodeDetail("workflow", WorkflowDetailView);
registerNodeDetail("html", HtmlDetailView);
registerSidePanelTab("whiteboard-preview", WhiteboardSidePanelPreview);
registerSidePanelTab("workflow-preview", WorkflowSidePanelPreview);
registerSidePanelTab("html-preview", HtmlSidePanelPreview);
