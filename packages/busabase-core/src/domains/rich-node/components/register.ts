import { registerNodeDetail } from "../../dashboard/node-detail-registry";
import { WorkflowDetailView } from "./graph-detail-view";
import { HtmlDetailView } from "./html-detail-view";
import { WhiteboardDetailView } from "./whiteboard-detail-view";

registerNodeDetail("whiteboard", WhiteboardDetailView);
registerNodeDetail("workflow", WorkflowDetailView);
registerNodeDetail("html", HtmlDetailView);
