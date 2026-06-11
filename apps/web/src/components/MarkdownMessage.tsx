import { Component, memo, type ReactNode } from "react";
import { debugForcedMarkdownEmergencyFallbackReason, reportMarkdownEmergencyFallback, type MarkdownContentSource } from "../domain/markdownRenderDiagnostics";
import { EmergencyFallbackRenderer } from "./markdown/EmergencyFallbackRenderer";
import { StaticMarkdownRenderer } from "./markdown/StaticMarkdownRenderer";
import { StreamingMarkdownRenderer } from "./markdown/StreamingMarkdownRenderer";

export type { MarkdownContentSource } from "../domain/markdownRenderDiagnostics";

type MarkdownMessageProps = {
  text: string;
  streaming?: boolean;
  source?: MarkdownContentSource;
};

type MarkdownRenderFaultBoundaryProps = {
  text: string;
  streaming: boolean;
  source: MarkdownContentSource;
  children: ReactNode;
};

type MarkdownRenderFaultBoundaryState = {
  reason?: string;
};

export const MarkdownMessage = memo(function MarkdownMessage({ text, streaming = false, source = "message" }: MarkdownMessageProps) {
  const forcedFallbackReason = debugForcedMarkdownEmergencyFallbackReason();
  if (forcedFallbackReason) {
    reportMarkdownEmergencyFallback({ source, streaming, textLength: text.length, reason: forcedFallbackReason });
    return <EmergencyFallbackRenderer text={text} source={source} reason={forcedFallbackReason} />;
  }
  return (
    <MarkdownRenderFaultBoundary source={source} streaming={streaming} text={text}>
      {streaming ? <StreamingMarkdownRenderer text={text} source={source} /> : <StaticMarkdownRenderer text={text} source={source} />}
    </MarkdownRenderFaultBoundary>
  );
});

class MarkdownRenderFaultBoundary extends Component<MarkdownRenderFaultBoundaryProps, MarkdownRenderFaultBoundaryState> {
  override state: MarkdownRenderFaultBoundaryState = {};

  static getDerivedStateFromError(error: unknown): MarkdownRenderFaultBoundaryState {
    return { reason: markdownRenderErrorReason(error) };
  }

  override componentDidCatch(error: unknown): void {
    reportMarkdownEmergencyFallback({
      source: this.props.source,
      streaming: this.props.streaming,
      textLength: this.props.text.length,
      reason: markdownRenderErrorReason(error),
    });
  }

  override componentDidUpdate(previousProps: MarkdownRenderFaultBoundaryProps): void {
    if (this.state.reason && (previousProps.text !== this.props.text || previousProps.streaming !== this.props.streaming || previousProps.source !== this.props.source)) {
      this.setState({ reason: undefined });
    }
  }

  override render() {
    if (this.state.reason) return <EmergencyFallbackRenderer text={this.props.text} source={this.props.source} reason={this.state.reason} />;
    return this.props.children;
  }
}

function markdownRenderErrorReason(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "markdown-render-failed";
}
