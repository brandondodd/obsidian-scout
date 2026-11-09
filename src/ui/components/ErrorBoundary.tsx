import React from "react";

interface Props {
	/** What failed, for the message: "library", "home page", … */
	what: string;
	children?: React.ReactNode;
}

interface State {
	error: Error | null;
}

/** How much of the stack to show: enough to place the fault in `main.js`. */
const STACK_LINES = 6;

/**
 * What a page shows when it fails to draw, instead of nothing.
 *
 * Without it, an error while rendering unmounts the whole tree and leaves an
 * empty pane under the tab's title — and on a phone, where there is no
 * console to read, nothing says what went wrong. The message and the top of
 * the stack are on screen and selectable, so they can be copied into a report.
 */
export class ErrorBoundary extends React.Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: unknown): State {
		return { error: error instanceof Error ? error : new Error(String(error)) };
	}

	componentDidCatch(error: unknown, info: React.ErrorInfo): void {
		console.error(`Scout: the ${this.props.what} failed to draw`, error, info.componentStack);
	}

	render(): React.ReactNode {
		const { error } = this.state;
		if (!error) return this.props.children;
		const stack = (error.stack ?? "")
			.split("\n")
			.filter((line) => line.trim() && !line.includes(error.message))
			.slice(0, STACK_LINES)
			.join("\n");
		return (
			<div className="scout-crash" role="alert">
				<p className="scout-crash-title">Scout couldn't show the {this.props.what}.</p>
				<pre className="scout-crash-detail">
					{error.name}: {error.message}
					{stack && `\n${stack}`}
				</pre>
				<button onClick={() => this.setState({ error: null })}>Try again</button>
			</div>
		);
	}
}
