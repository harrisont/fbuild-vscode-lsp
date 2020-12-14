# FASTBuild Language Server and VS Code Client

Contains a language server and Visual Studio Code client for the [FASTBuild](https://www.fastbuild.org/) language.

This provides the following functionality:
* Go to definition of a variable.
* Find references of a variable.
* Hover over an evaluated variable to show a tooltip with its evaulated value (e.g. the evaluation `Location` variable in `.Message = 'Hello $Location$` or `.Message = .Location`).

It does not yet provide syntax highlighting. For that, I recommend the FASTBuild (`roscop.fastbuild`) extension ([extension website](https://marketplace.visualstudio.com/items?itemName=RoscoP.fastbuild)).

## Compatibility

Compatible with [FASTBuild](https://www.fastbuild.org/) version 1.02.

Note that much of the language is not yet implemented. See [TODO](#todo) for details.

## Running

1. Run `npm install` in this folder. This installs all necessary npm modules in both the client and server folder.
2. Open VS Code on this folder.
3. Run the `compile` task, which compiles the client and server. Alternatively, run the `watch-compile` task to watch for changes and automatically compile.
4. Run the `Launch Client` launch configuration. If you want to debug the server as well, use `Launch Client + Server` instead.

## Testing

* Run the `test` task. Alternatively, run the `watch-test` task to watch for changes and automatically run tests.
* Debug the tests by running the `Run Tests` launch configuration.

## Implementation Notes

* Parses using [Nearley](https://nearley.js.org/), which lexes using [moo](https://github.com/no-context/moo).
    * [Nearley Parser Playground](https://omrelli.ug/nearley-playground/)
	* Example: [Moo.js Tokenizer with Nearley.js](https://www.youtube.com/watch?v=GP91_duEmk8)
* VS Code language server extension resources:
    * [VS Code Language Server Extension Guide](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide)
	* [How to create a language server and VS Code extension](https://github.com/donaldpipowitch/how-to-create-a-language-server-and-vscode-extension)
	* [Language Server Protocol: A Language Server For DOT With Visual Studio Code](https://tomassetti.me/language-server-dot-visual-studio/)
* Other resources:
    * [RegEx101](https://regex101.com/): regex playgound

## TODO

* Support dynamic variable names ([docs](https://www.fastbuild.org/docs/syntaxguide.html#dynamic_construction)).
* Support multiple documents. Right now everything assumes a single document.
* Support `#include` ([docs](https://www.fastbuild.org/docs/syntaxguide.html#include)).
* Support functions that change how we evaluate:
    * `ForEach` ([docs](https://www.fastbuild.org/docs/functions/foreach.html))
    * `If` ([docs](https://www.fastbuild.org/docs/functions/if.html))
* Support functions that define aliases. We only need to support them to the extent that we detect the alias name and handle the function body's statements.
    * `Alias`
    * `Compiler`
    * `Copy`
    * `CopyDir`
    * `CSAssembly`
    * `DLL`
    * `Exec`
    * `Executable`
    * `Library`
    * `ObjectList`
    * `RemoveDir`
    * `Test`
    * `TextFile`
    * `Unity`
    * `VCXProject`
    * `VSProjectExternal`
    * `VSSolution`
    * `XCodeProject`
* Support "go to definition" and "find references" for aliases.
* Support functions that take immediate actions but do not change how we evaluate.
    * `Error`
    * `Print`
    * `Settings`
* Support the `_CURRENT_BFF_DIR_` built in variable ([docs](https://www.fastbuild.org/docs/syntaxguide.html#builtin)).
* Support the `_WORKING_DIR_` built in variable ([docs](https://www.fastbuild.org/docs/syntaxguide.html#builtin)).
* Support `#define` / `#undef` ([docs](https://www.fastbuild.org/docs/syntaxguide.html#define)) and `#if` / `#else` / `#endif` ([docs](https://www.fastbuild.org/docs/syntaxguide.html#if)).
* Support variable subtraction ([docs](https://www.fastbuild.org/docs/syntaxguide.html#modification)). This is low priority, since I have never seen it used.
