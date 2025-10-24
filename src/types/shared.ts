export interface Loc {
	line: number;
	col: number;
	offset: number;
}

export interface Pos {
	start: Loc;
	end: Loc;
}

export interface NoteMetadata {
	frontmatter: Record<string, unknown>;
	position: Pos | null;
}
