import {
    createConnection,
    InitializeParams,
    InitializeResult,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
} from 'vscode-languageserver';

import {
    TextDocument,
} from 'vscode-languageserver-textdocument';

// Used to manipulate URIs.
import * as vscodeUri from 'vscode-uri';

import { ParseError } from './parser';

import {
    evaluate,
    EvaluatedData,
    EvaluationError,
    SourceRange,
} from './evaluator';

import { HoverProvider } from './features/hoversProvider';
import { DefinitionProvider } from './features/definitionProvider';
import { DiagnosticProvider } from './features/diagnosticProvider';
import { ReferenceProvider } from './features/referenceProvider';
import { DiskFileSystem } from './fileSystem';
import { ParseDataProvider } from './parseDataProvider';

import * as fs from 'fs';

const ROOT_FBUILD_FILE = 'fbuild.bff';

type UriStr = string;

// Given a FASTBuild file, find the root FASTBuild file that included it.
//
// The root FASTBuild file must be in one of the parent directories.
//
// Return null if no root FASTBuild file exists.
//
// Given the root FASTBuild file, returns itself.
function getRootFbuildFile(uri: vscodeUri.URI): vscodeUri.URI | null {
    let searchUri = uri;
    while (searchUri.path !== '/') {
        searchUri = vscodeUri.Utils.dirname(searchUri);
        const potentialRootFbuildUri = vscodeUri.Utils.joinPath(searchUri, ROOT_FBUILD_FILE);
        if (fs.existsSync(potentialRootFbuildUri.fsPath)) {
            return potentialRootFbuildUri;
        }
    }
    return null;
}

class State {
    // Create a connection for the server, using Node's IPC as a transport.
    // Also include all preview / proposed LSP features.
    readonly connection = createConnection(ProposedFeatures.all);

    readonly documents = new TextDocuments(TextDocument);

    fileSystem = new DiskFileSystem(this.documents);

    parseDataProvider = new ParseDataProvider(
        this.fileSystem,
        {
            enableDiagnostics: false
        }
    );

    // Cache the mapping of FASTBuild file to root-FASTBuild file, so that we don't need to compute it each time.
    readonly fileToRootFbuildFileCache = new Map<UriStr, vscodeUri.URI>();

    readonly hoverProvider = new HoverProvider();
    readonly definitionProvider = new DefinitionProvider();
    readonly referenceProvider = new ReferenceProvider();
    readonly diagnosticProvider = new DiagnosticProvider();

    // Map of open documents to their root FASTBuild file
    readonly openDocumentToRootMap = new Map<UriStr, UriStr>();

    // Same API as the non-member getRootFbuildFile.
    getRootFbuildFile(uri: vscodeUri.URI): vscodeUri.URI | null {
        const cachedRootUri = this.fileToRootFbuildFileCache.get(uri.toString());
        if (cachedRootUri === undefined) {
            const rootUri = getRootFbuildFile(uri);
            if (rootUri === null) {
                return null;
            }
            this.fileToRootFbuildFileCache.set(uri.toString(), rootUri);
            return rootUri;
        } else {
            return cachedRootUri;
        }
    }
}

const state = new State();

state.connection.onInitialize((params: InitializeParams) => {
    const capabilities = params.capabilities;

    const hasDiagnosticRelatedInformationCapability = !!(
        capabilities.textDocument &&
        capabilities.textDocument.publishDiagnostics &&
        capabilities.textDocument.publishDiagnostics.relatedInformation
    );

    state.diagnosticProvider.hasDiagnosticRelatedInformationCapability = hasDiagnosticRelatedInformationCapability;

    const result: InitializeResult = {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Incremental,
            hoverProvider: true,
            definitionProvider: true,
            referencesProvider: true,
        }
    };

    return result;
});

state.connection.onHover(state.hoverProvider.onHover.bind(state.hoverProvider));
state.connection.onDefinition(state.definitionProvider.onDefinition.bind(state.definitionProvider));
state.connection.onReferences(state.referenceProvider.onReferences.bind(state.referenceProvider));

// The content of a file has changed. This event is emitted when the file first opened or when its content has changed.
state.documents.onDidChangeContent(change => updateDocument(change.document.uri));

function updateDocument(changedDocumentUriStr: UriStr): void {
    const changedDocumentUri = vscodeUri.URI.parse(changedDocumentUriStr);

    let evaluatedData = new EvaluatedData();
    let rootFbuildUriStr = '';
    try {
        // We need to start evaluating from the root FASTBuild file, not from the changed one.
        // This is because changes to a file can affect other files.
        // A future optimization would be to support incremental evaluation.
        const rootFbuildUri = state.getRootFbuildFile(changedDocumentUri);
        if (rootFbuildUri === null) {
            const errorRange = SourceRange.create(changedDocumentUriStr, 0, 0, Number.MAX_VALUE, Number.MAX_VALUE);
            throw new EvaluationError(errorRange, `Could not find a root FASTBuild file ('${ROOT_FBUILD_FILE}') for document '${changedDocumentUri.fsPath}'`);
        }
        rootFbuildUriStr = rootFbuildUri.toString();

        const maybeChangedDocumentParseData = state.parseDataProvider.updateParseData(changedDocumentUri);
        if (maybeChangedDocumentParseData.hasError) {
            throw maybeChangedDocumentParseData.getError();
        }

        const maybeRootFbuildParseData = state.parseDataProvider.getParseData(rootFbuildUri);
        if (maybeRootFbuildParseData.hasError) {
            throw maybeRootFbuildParseData.getError();
        }
        const rootFbuildParseData = maybeRootFbuildParseData.getValue();

        const evaluatedDataAndMaybeError = evaluate(rootFbuildParseData, rootFbuildUriStr, state.fileSystem, state.parseDataProvider);
        evaluatedData = evaluatedDataAndMaybeError.data;
        if (evaluatedDataAndMaybeError.error !== null) {
            throw evaluatedDataAndMaybeError.error;
        }
        
        state.diagnosticProvider.clearDiagnosticsForRoot(rootFbuildUriStr, state.connection);
    } catch (error) {
        if (error instanceof ParseError) {
            state.diagnosticProvider.setParseErrorDiagnostic(rootFbuildUriStr, error, state.connection);
        } else if (error instanceof EvaluationError) {
            state.diagnosticProvider.setEvaluationErrorDiagnostic(rootFbuildUriStr, error, state.connection);
        } else {
            state.diagnosticProvider.setUnknownErrorDiagnostic(rootFbuildUriStr, error, state.connection);
        }
    }

    state.hoverProvider.onEvaluatedDataChanged(evaluatedData);
    state.definitionProvider.onEvaluatedDataChanged(changedDocumentUri.toString(), evaluatedData);
    state.referenceProvider.onEvaluatedDataChanged(changedDocumentUri.toString(), evaluatedData);
}

// Track the open files by root FASTBuild file.
state.documents.onDidOpen(change => {
    const changedDocumentUriStr: UriStr = change.document.uri;
    const changedDocumentUri = vscodeUri.URI.parse(changedDocumentUriStr);
    const rootFbuildUri = state.getRootFbuildFile(changedDocumentUri);
    // If a document has no root, use itself as its root.
    const rootFbuildUriStr = rootFbuildUri ? rootFbuildUri.toString() : changedDocumentUriStr;
    state.openDocumentToRootMap.set(changedDocumentUriStr, rootFbuildUriStr);
});

// If the closed document's root's tree has no more open documents, clear diagnostics for the root.
state.documents.onDidClose(change => {
    const closedDocumentUriStr: UriStr = change.document.uri;
    const rootFbuildUriStr = state.openDocumentToRootMap.get(closedDocumentUriStr);
    if (rootFbuildUriStr === undefined) {
        return;
    }
    state.openDocumentToRootMap.delete(closedDocumentUriStr);
    if (!Array.from(state.openDocumentToRootMap.values()).includes(rootFbuildUriStr)) {
        state.diagnosticProvider.clearDiagnosticsForRoot(rootFbuildUriStr, state.connection);
    }
});

// Make the text document manager listen on the connection for open, change and close text document events.
state.documents.listen(state.connection);
state.connection.listen();