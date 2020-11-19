@{%
const moo = require('moo');

const lexer = moo.states({
    main: {
        whitespace: /[ \t]+/,
        optionalWhitespaceAndMandatoryNewline: { match: /[ \t\n]*\n[ \t\n]*/, lineBreaks: true },
        comment: /(?:;|\/\/).*/,
        scopeStart: '{',
        scopeEnd: '}',
        integer: { match: /0|[1-9][0-9]*/, value: (s: string) => parseInt(s) },
        singleQuotedStringStart: { match: "'", push: 'singleQuotedStringBody' },
        doubleQuotedStringStart: { match: '"', push: 'doubleQuotedStringBody' },
        variableName: /[a-zA-Z_][a-zA-Z0-9_]*/,
        variableReferenceCurrentScope: '.',
        variableReferenceParentScope: '^',
        operatorAssignment: '=',
        operatorAddition: '+',
    },
    singleQuotedStringBody: {
        startTemplatedVariable: { match: '$', push: 'templatedVariable' },
        stringEnd: { match: "'", pop: 1 },
        // Handle escaping ', $, ^ with ^
        stringLiteral: /(?:[^'\$\^\n]|\^['$\^])+/,
    },
    doubleQuotedStringBody: {
        startTemplatedVariable: { match: '$', push: 'templatedVariable' },
        stringEnd: { match: '"', pop: 1 },
        // Handle escaping ", $, ^ with ^
        stringLiteral: /(?:[^"\$\^\n]|\^["$\^])+/,
    },
    templatedVariable: {
        endTemplatedVariable: { match: '$', pop: 1 },
        variableName: /[a-zA-Z_][a-zA-Z0-9_]*/,
    }
});
%}

# Pass your lexer object using the @lexer option:
@lexer lexer

@preprocessor typescript

main -> lines  {% function(d) { return d[0]; } %}

lines ->
    null  {% function(d) { return []; } %}
  | %optionalWhitespaceAndMandatoryNewline lines  {% function(d) { return d[1]; } %}
  | %whitespace lines  {% function(d) { return d[1]; } %}
  | statementAndOrComment lines  {% function(d) { return d.flat(); } %}

statementAndOrComment ->
    statement %optionalWhitespaceAndMandatoryNewline  {% function(d) { return d[0]; } %}
  | statement %comment %optionalWhitespaceAndMandatoryNewline  {% function(d) { return d[0]; } %}
  | statement %whitespace %comment %optionalWhitespaceAndMandatoryNewline  {% function(d) { return d[0]; } %}
  | %comment %optionalWhitespaceAndMandatoryNewline  {% function(d) { return []; } %}

statement ->
    %scopeStart  {% function(d) { return { type: "scopeStart" }; } %}
  | %scopeEnd  {% function(d) { return { type: "scopeEnd" }; } %}
  | variableDefinition  {% function(d) { return d[0]; } %}
  | variableAddition  {% function(d) { return d[0]; } %}

variableDefinition ->
    # No whitespace/newlines.
    lhs %operatorAssignment rhs                                                                                {% ([lhs, operator, rhs]) =>                 { return { type: "variableDefinition", lhs: lhs, rhs: rhs }; } %}
    # Whitespace/newlines left of the operator.
  | lhs %whitespace %operatorAssignment rhs                                                                    {% ([lhs, space1, operator, rhs]) =>         { return { type: "variableDefinition", lhs: lhs, rhs: rhs }; } %}
  | lhs %optionalWhitespaceAndMandatoryNewline %operatorAssignment rhs                                         {% ([lhs, space1, operator, rhs]) =>         { return { type: "variableDefinition", lhs: lhs, rhs: rhs }; } %}
    # Whitespace/newlines right of the operator.
  | lhs %operatorAssignment %whitespace rhs                                                                    {% ([lhs, operator, space2, rhs]) =>         { return { type: "variableDefinition", lhs: lhs, rhs: rhs }; } %}
  | lhs %operatorAssignment %optionalWhitespaceAndMandatoryNewline rhs                                         {% ([lhs, operator, space2, rhs]) =>         { return { type: "variableDefinition", lhs: lhs, rhs: rhs }; } %}
    # Whitespace/newlines left and right of the operator.
  | lhs %whitespace %operatorAssignment %whitespace rhs                                                        {% ([lhs, space1, operator, space2, rhs]) => { return { type: "variableDefinition", lhs: lhs, rhs: rhs }; } %}
  | lhs %optionalWhitespaceAndMandatoryNewline %operatorAssignment %whitespace rhs                             {% ([lhs, space1, operator, space2, rhs]) => { return { type: "variableDefinition", lhs: lhs, rhs: rhs }; } %}
  | lhs %whitespace %operatorAssignment %optionalWhitespaceAndMandatoryNewline rhs                             {% ([lhs, space1, operator, space2, rhs]) => { return { type: "variableDefinition", lhs: lhs, rhs: rhs }; } %}
  | lhs %optionalWhitespaceAndMandatoryNewline %operatorAssignment %optionalWhitespaceAndMandatoryNewline rhs  {% ([lhs, space1, operator, space2, rhs]) => { return { type: "variableDefinition", lhs: lhs, rhs: rhs }; } %}

variableAddition ->
    # No whitespace/newlines.
    lhs %operatorAddition rhs                                                                                {% ([lhs, operator, rhs]) =>                 { return { type: "variableAddition", lhs: lhs, rhs: rhs }; } %}
    # Whitespace/newlines left of the operator.
  | lhs %whitespace %operatorAddition rhs                                                                    {% ([lhs, space1, operator, rhs]) =>         { return { type: "variableAddition", lhs: lhs, rhs: rhs }; } %}
  | lhs %optionalWhitespaceAndMandatoryNewline %operatorAddition rhs                                         {% ([lhs, space1, operator, rhs]) =>         { return { type: "variableAddition", lhs: lhs, rhs: rhs }; } %}
    # Whitespace/newlines right of the operator.
  | lhs %operatorAddition %whitespace rhs                                                                    {% ([lhs, operator, space2, rhs]) =>         { return { type: "variableAddition", lhs: lhs, rhs: rhs }; } %}
  | lhs %operatorAddition %optionalWhitespaceAndMandatoryNewline rhs                                         {% ([lhs, operator, space2, rhs]) =>         { return { type: "variableAddition", lhs: lhs, rhs: rhs }; } %}
    # Whitespace/newlines left and right of the operator.
  | lhs %whitespace %operatorAddition %whitespace rhs                                                        {% ([lhs, space1, operator, space2, rhs]) => { return { type: "variableAddition", lhs: lhs, rhs: rhs }; } %}
  | lhs %optionalWhitespaceAndMandatoryNewline %operatorAddition %whitespace rhs                             {% ([lhs, space1, operator, space2, rhs]) => { return { type: "variableAddition", lhs: lhs, rhs: rhs }; } %}
  | lhs %whitespace %operatorAddition %optionalWhitespaceAndMandatoryNewline rhs                             {% ([lhs, space1, operator, space2, rhs]) => { return { type: "variableAddition", lhs: lhs, rhs: rhs }; } %}
  | lhs %optionalWhitespaceAndMandatoryNewline %operatorAddition %optionalWhitespaceAndMandatoryNewline rhs  {% ([lhs, space1, operator, space2, rhs]) => { return { type: "variableAddition", lhs: lhs, rhs: rhs }; } %}

lhs ->
    "." %variableName  {% function(d) { return { name: d[1].value, scope: "current" }; } %}
  | "^" %variableName  {% function(d) { return { name: d[1].value, scope: "parent" }; } %}

rhs ->
    %integer  {% function(d) { return d[0].value; } %}
  | bool  {% function(d) { return d[0]; } %}
  # evaluatedVariable is in stringExpression and not rhs in order to remove ambiguity
  | stringExpression  {% function(d) { return d[0]; } %}

evaluatedVariable -> "." %variableName  {% ([_, varName]) => {
    return [
        {
            type: "evaluatedVariable",
            name: varName.value,
            line: varName.line - 1,
            // Include the "." character.
            characterStart: varName.col - 2,
            // TODO: determine the end. See the known issue in README.md.
            characterEnd: 10000,
        }
    ];
} %}

bool ->
    "true"  {% function(d) { return true; } %}
  | "false"  {% function(d) { return false; } %}

# Generates string | (string | evaluatedVariable)[]
# Merges string literals.
# e.g. ['hello', ' world'] becomes 'hello world'
# e.g. ['hello', ' world', evaluatedVariable] becomes ['hello world', evaluatedVariable]
stringExpression -> stringExpressionHelper  {% ([parts]) => {
    let joinedParts: (string | object)[] = [];
    let previousPartIsStringLiteral: boolean = false;
    for (const part of parts) {
        const isStringLiteral: boolean = (typeof part == "string");
        if (isStringLiteral && previousPartIsStringLiteral) {
          joinedParts[joinedParts.length - 1] += part;
        } else {
          joinedParts.push(part);
        }
        
        previousPartIsStringLiteral = isStringLiteral;
    }
    if ((joinedParts.length == 1) && (typeof joinedParts[0] == "string")) {
      return joinedParts[0];
    } else {
      return joinedParts;
    }
} %}

# Generates an array of either string or evaluatedVariables: (string | evaluatedVariable)[]
stringExpressionHelper ->
    # Single string
    stringOrEvaluatedVariable                                                                                                                         {% function(d) { return d[0]; } %}
    # Multiple strings added together. No whitespace/newlines.
  | stringOrEvaluatedVariable %operatorAddition stringExpressionHelper                                                                                {% ([lhs, operator, rhs]) =>                 { return [...lhs, ...rhs]; } %}
    # Multiple strings added together. Whitespace/newlines left of the operator.
  | stringOrEvaluatedVariable %whitespace %operatorAddition stringExpressionHelper                                                                    {% ([lhs, space1, operator, rhs]) =>         { return [...lhs, ...rhs]; } %}
  | stringOrEvaluatedVariable %optionalWhitespaceAndMandatoryNewline %operatorAddition stringExpressionHelper                                         {% ([lhs, space1, operator, rhs]) =>         { return [...lhs, ...rhs]; } %}
    # Multiple strings added together. Whitespace/newlines right of the operator.
  | stringOrEvaluatedVariable %operatorAddition %whitespace stringExpressionHelper                                                                    {% ([lhs, operator, space2, rhs]) =>         { return [...lhs, ...rhs]; } %}
  | stringOrEvaluatedVariable %operatorAddition %optionalWhitespaceAndMandatoryNewline stringExpressionHelper                                         {% ([lhs, operator, space2, rhs]) =>         { return [...lhs, ...rhs]; } %}
    # Multiple strings added together. Whitespace/newlines left and right of the operator.
  | stringOrEvaluatedVariable %whitespace %operatorAddition %whitespace stringExpressionHelper                                                        {% ([lhs, space1, operator, space2, rhs]) => { return [...lhs, ...rhs]; } %}
  | stringOrEvaluatedVariable %optionalWhitespaceAndMandatoryNewline %operatorAddition %whitespace stringExpressionHelper                             {% ([lhs, space1, operator, space2, rhs]) => { return [...lhs, ...rhs]; } %}
  | stringOrEvaluatedVariable %whitespace %operatorAddition %optionalWhitespaceAndMandatoryNewline stringExpressionHelper                             {% ([lhs, space1, operator, space2, rhs]) => { return [...lhs, ...rhs]; } %}
  | stringOrEvaluatedVariable %optionalWhitespaceAndMandatoryNewline %operatorAddition %optionalWhitespaceAndMandatoryNewline stringExpressionHelper  {% ([lhs, space1, operator, space2, rhs]) => { return [...lhs, ...rhs]; } %}

stringOrEvaluatedVariable ->
    string  {% function(d) { return d[0]; } %}
  | evaluatedVariable  {% function(d) { return d[0]; } %}

string ->
    %singleQuotedStringStart stringContents %stringEnd  {% ([quoteStart, content, quoteEnd]) => content %}
  | %doubleQuotedStringStart stringContents %stringEnd  {% ([quoteStart, content, quoteEnd]) => content %}

# Generates an array of either string or evaluatedVariables: (string | evaluatedVariable)[]
stringContents ->
    null
    # String literal
  | %stringLiteral stringContents  {% ([literal, rest]) => {
        // Handle escaped characters.
        const escapedValue = literal.value.replace(/\^(.)/g, '$1');

        if (rest.length > 0) {
            return [escapedValue, ...rest];
        } else {
            return [escapedValue];
        }
    } %}
    # Templated string
  | %startTemplatedVariable %variableName %endTemplatedVariable stringContents  {% ([startVarIndicator, varName, endVarIndicator, rest]) => {
          const evaluatedVariable = {
            type: "evaluatedVariable",
            name: varName.value,
            line: varName.line - 1,
            // Include the start and end "$" characters.
            characterStart: startVarIndicator.col - 1,
            characterEnd: endVarIndicator.col,
        };
        if (rest.length > 0) {
            return [evaluatedVariable, ...rest];
        } else {
            return [evaluatedVariable];
        }
    } %}
