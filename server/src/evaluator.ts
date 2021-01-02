import {
    ParseData,
    ParseSourceRange,
    SourcePosition,
    Statement,
} from './parser';

import { ParseDataProvider, Uri } from './parseDataProvider';

// Used to manipulate URIs.
import * as vscodeUri from 'vscode-uri';

export class EvaluationError extends Error {
    constructor(message?: string) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
        this.name = EvaluationError.name;
    }
}

export type Value = boolean | number | string | Value[] | Struct;

export class Struct extends Map<string, Value> {
}

export class SourceRange {
    readonly start: SourcePosition;
    readonly end: SourcePosition;

    constructor(readonly uri: Uri, parseSourceRange: ParseSourceRange) {
        this.start = parseSourceRange.start;
        this.end = parseSourceRange.end;
    }
}

export interface EvaluatedVariable {
    value: Value;
    range: SourceRange;
}

export interface VariableDefinition {
    id: number;
    range: SourceRange;
}

export interface VariableReference {
    definition: VariableDefinition;
    range: SourceRange;
    // Set when the reference is to a variable defined in a struct brought into scope from a `Using` call.
    usingRange: SourceRange | null;
}

export interface EvaluatedData {
    evaluatedVariables: EvaluatedVariable[];
    variableReferences: VariableReference[];
    variableDefinitions: Map<string, VariableDefinition>;
}

type ScopeLocation = 'current' | 'parent';

interface VariableDefinitionLhs {
    name: string;
    scope: ScopeLocation;
    range: ParseSourceRange;
}

interface ParsedEvaluatedVariable {
    type: 'evaluatedVariable';
    name: string;
    scope: ScopeLocation;
    range: ParseSourceRange;
}

interface EvaluatedRValue {
    value: Value;
    evaluatedVariables: EvaluatedVariable[];
    variableReferences: VariableReference[];
    // Used for structs.
    variableDefinitions: Map<string, VariableDefinition>;
}

interface EvaluatedStringExpression {
    evaluatedString: string;
    evaluatedVariables: EvaluatedVariable[];
    variableReferences: VariableReference[];
}

interface EvaluatedEvaluatedVariable {
    valueScopeVariable: ScopeVariable;
    // Includes any evaluated variables/references in a an evaluated (dynamic) variable name.
    evaluatedVariables: EvaluatedVariable[];
    variableReferences: VariableReference[];
}

interface ScopeVariable {
    value: Value;
    definition: VariableDefinition;
    // Set if `value` is a Struct.
    structMemberDefinitions: Map<string, VariableDefinition> | null;
    // Set if the variable was created from a `Using` statement.
    usingRange: SourceRange | null;
}

interface Scope {
    variables: Map<string, ScopeVariable>;
}

class ScopeStack {
    private stack: Array<Scope> = []
    private nextVariableDefinitionId = 1;

    constructor() {
        this.push();
    }

    push() {
        const scope: Scope = {
            variables: new Map<string, ScopeVariable>()
        };

        this.stack.push(scope);
    }

    pop() {
        if (this.stack.length < 2) {
            throw new EvaluationError('Cannot pop scope because there is no parent scope.');
        }
        this.stack.pop();
    }

    // Get a variable, searching from the current scope to its parents.
    // Throw EvaluationError if the variable is not defined.
    getVariableStartingFromCurrentScope(variableName: string): ScopeVariable {
        for (let scopeIndex = this.stack.length - 1; scopeIndex >= 0; --scopeIndex) {
            const scope = this.stack[scopeIndex];
            const maybeVariable = scope.variables.get(variableName);
            if (maybeVariable !== undefined) {
                return maybeVariable;
            }
        }
        throw new EvaluationError(`Referencing variable "${variableName}" that is undefined in the current scope or any of the parent scopes.`);
    }

    // Throw EvaluationError if the variable is not defined.
    getVariableInCurrentScope(variableName: string): ScopeVariable {
        const currentScope = this.getCurrentScope();
        const maybeVariable = currentScope.variables.get(variableName);
        if (maybeVariable === undefined) {
            throw new EvaluationError(`Referencing varable "${variableName}" that is undefined in the current scope.`);
        } else {
            return maybeVariable;
        }
    }

    // Throw EvaluationError if the variable is not defined.
    getVariableInParentScope(variableName: string): ScopeVariable {
        const parentScope = this.getParentScope();
        const maybeVariable = parentScope.variables.get(variableName);
        if (maybeVariable === undefined) {
            throw new EvaluationError(`Referencing varable "${variableName}" that is undefined in the parent scope.`);
        } else {
            return maybeVariable;
        }
    }

    // Throw EvaluationError if the variable is not defined.
    getVariableInScope(scope: ScopeLocation, variableName: string): ScopeVariable {
        if (scope == 'current') {
            return this.getVariableInCurrentScope(variableName);
        } else {
            return this.getVariableInParentScope(variableName);
        }
    }

    setVariableInCurrentScope(name: string, value: Value, definition: VariableDefinition): ScopeVariable {
        const currentScope = this.getCurrentScope();
        const existingVariable = currentScope.variables.get(name);
        if (existingVariable === undefined) {
            const variable: ScopeVariable = {
                value: value,
                definition: definition,
                structMemberDefinitions: null,
                usingRange: null,
            };
            currentScope.variables.set(name, variable);
            return variable;
        } else {
            existingVariable.value = value;
            return existingVariable;
        }
    }

    updateExistingVariableInCurrentScope(name: string, value: Value): ScopeVariable {
        const currentScope = this.getCurrentScope();
        const existingVariable = currentScope.variables.get(name);
        if (existingVariable === undefined) {
            throw new EvaluationError(`Cannot update variable "${name}" in current scope because the variable does not exist in the current scope.`);
        }
        existingVariable.value = value;
        return existingVariable;
    }

    updateExistingVariableInParentScope(name: string, value: Value): ScopeVariable {
        const parentScope = this.getParentScope();
        const existingVariable = parentScope.variables.get(name);
        if (existingVariable === undefined) {
            throw new EvaluationError(`Cannot update variable "${name}" in parent scope because the variable does not exist in the parent scope.`);
        }
        existingVariable.value = value;
        return existingVariable;
    }

    updateExistingVariableInScope(scope: ScopeLocation, name: string, value: Value): ScopeVariable {
        if (scope == 'current') {
            return this.updateExistingVariableInCurrentScope(name, value);
        } else {
            return this.updateExistingVariableInParentScope(name, value);
        }
    }

    getCurrentScope(): Scope {
        return this.stack[this.stack.length - 1];
    }

    private getParentScope(): Scope {
        if (this.stack.length < 2) {
            throw new EvaluationError(`Cannot access parent scope because there is no parent scope.`);
        }
        return this.stack[this.stack.length - 2];
    }

    createVariableDefinition(range: SourceRange): VariableDefinition {
        const id = this.nextVariableDefinitionId;
        this.nextVariableDefinitionId += 1;
        return {
            id,
            range,
        };
    }
}

// thisFbuildUri is used to calculate relative paths (e.g. from #include)
export function evaluate(parseData: ParseData, thisFbuildUri: string, parseDataProvider: ParseDataProvider): EvaluatedData {
    const context = {
        scopeStack: new ScopeStack(),
        thisFbuildUri,
        parseDataProvider,
    };
    return evaluateStatements(parseData.statements, context);
}

interface EvaluationContext {
    scopeStack: ScopeStack,
    thisFbuildUri: string,
    parseDataProvider: ParseDataProvider,
}

function evaluateStatements(statements: Statement[], context: EvaluationContext): EvaluatedData {
    const result: EvaluatedData = {
        evaluatedVariables: [],
        variableReferences: [],
        variableDefinitions: new Map<string, VariableDefinition>(),
    };

    for (const statement of statements) {
        switch (statement.type) {
            case 'variableDefinition': {
                const evaluatedRhs = evaluateRValue(statement.rhs, context);
                result.evaluatedVariables.push(...evaluatedRhs.evaluatedVariables);
                result.variableReferences.push(...evaluatedRhs.variableReferences);
                for (const [varName, varDefinition] of evaluatedRhs.variableDefinitions) {
                    result.variableDefinitions.set(varName, varDefinition);
                }

                const lhs: VariableDefinitionLhs = statement.lhs;

                const evaluatedLhsName = evaluateRValue(lhs.name, context);
                if (typeof evaluatedLhsName.value !== 'string') {
                    throw new EvaluationError(`Variable name must evaluate to a string, but was ${JSON.stringify(evaluatedLhsName.value)}`);
                }
                result.evaluatedVariables.push(...evaluatedLhsName.evaluatedVariables);
                result.variableReferences.push(...evaluatedLhsName.variableReferences);

                const lhsRange = new SourceRange(context.thisFbuildUri, lhs.range);

                let variable: ScopeVariable | null = null;
                if (lhs.scope == 'current') {
                    const definition = context.scopeStack.createVariableDefinition(lhsRange);
                    variable = context.scopeStack.setVariableInCurrentScope(evaluatedLhsName.value, evaluatedRhs.value, definition);
                } else {
                    variable = context.scopeStack.updateExistingVariableInParentScope(evaluatedLhsName.value, evaluatedRhs.value);
                }

                if (evaluatedRhs.value instanceof Struct) {
                    variable.structMemberDefinitions = evaluatedRhs.variableDefinitions;
                }

                // The definition's LHS is a variable reference.
                result.variableReferences.push({
                    definition: variable.definition,
                    range: lhsRange,
                    usingRange: null,
                });

                
                // The definition's LHS is a variable definition.
                result.variableDefinitions.set(lhs.name, variable.definition);

                break;
            }
            case 'variableAddition': {
                const evaluatedRhs = evaluateRValue(statement.rhs, context);
                result.evaluatedVariables.push(...evaluatedRhs.evaluatedVariables);
                result.variableReferences.push(...evaluatedRhs.variableReferences);

                const lhs: VariableDefinitionLhs = statement.lhs;

                const evaluatedLhsName = evaluateRValue(lhs.name, context);
                if (typeof evaluatedLhsName.value !== 'string') {
                    throw new EvaluationError(`Variable name must evaluate to a string, but was ${JSON.stringify(evaluatedLhsName.value)}`);
                }
                result.evaluatedVariables.push(...evaluatedLhsName.evaluatedVariables);
                result.variableReferences.push(...evaluatedLhsName.variableReferences);

                const existingVariable = context.scopeStack.getVariableInScope(lhs.scope, evaluatedLhsName.value);
                existingVariable.value = inPlaceAdd(existingVariable.value, evaluatedRhs.value);

                // The addition's LHS is a variable reference.
                result.variableReferences.push({
                    definition: existingVariable.definition,
                    range: new SourceRange(context.thisFbuildUri, lhs.range),
                    usingRange: null,
                });

                break;
            }
            case 'scopedStatements': {
                context.scopeStack.push();
                const evaluatedStatements = evaluateStatements(statement.statements, context);
                context.scopeStack.pop();

                result.evaluatedVariables.push(...evaluatedStatements.evaluatedVariables);
                result.variableReferences.push(...evaluatedStatements.variableReferences);
                for (const [varName, varDefinition] of evaluatedStatements.variableDefinitions) {
                    result.variableDefinitions.set(varName, varDefinition);
                }
                
                break;
            }
            case 'using': {
                if (statement.struct.type !== 'evaluatedVariable') {
                    throw new EvaluationError(`'Using' parameter must be an evaluated variable but instead is '${statement.struct.type}'`);
                }
                const evaluated = evaluateEvaluatedVariable(statement.struct, context);
                result.evaluatedVariables.push(...evaluated.evaluatedVariables);
                result.variableReferences.push(...evaluated.variableReferences);

                const struct = evaluated.valueScopeVariable.value;
                if (!(struct instanceof Struct)) {
                    throw new EvaluationError(`'Using' parameter must be a struct`);
                }

                const structVariable = evaluated.valueScopeVariable;
                if (structVariable.structMemberDefinitions === null) {
                    throw new EvaluationError(`'Using' parameter variable does not have the 'structMemberDefinitions' property set`);
                }
                for (const [varName, varValue] of struct) {
                    const definition = structVariable.structMemberDefinitions.get(varName);
                    if (definition === undefined) {
                        throw new EvaluationError(`'Using' parameter variable does not have a 'structMemberDefinitions' entry for the "${varName}" member variable`);
                    }
                    const variable = context.scopeStack.setVariableInCurrentScope(varName, varValue, definition);
                    const statementRange: ParseSourceRange = statement.range;
                    variable.usingRange = new SourceRange(context.thisFbuildUri, statementRange);
                }

                break;
            }
            case 'forEach': {
                // Evaluate the array to loop over.
                if (statement.arrayToLoopOver.type !== 'evaluatedVariable') {
                    throw new EvaluationError(`'ForEach' array to loop over must be an evaluated variable but instead is '${statement.arrayToLoopOver.type}'`);
                }
                const arrayToLoopOver: ParsedEvaluatedVariable = statement.arrayToLoopOver;
                const evaluatedArrayToLoopOver = evaluateEvaluatedVariable(arrayToLoopOver, context);
                result.evaluatedVariables.push(...evaluatedArrayToLoopOver.evaluatedVariables);
                result.variableReferences.push(...evaluatedArrayToLoopOver.variableReferences);

                interface LoopVar {
                    name: string,
                    range: ParseSourceRange,
                }
                const loopVar: LoopVar = statement.loopVar;
                const loopVarRange = new SourceRange(context.thisFbuildUri, loopVar.range);

                // Evaluate the loop-variable name.
                const evaluatedLoopVarName = evaluateRValue(loopVar.name, context);
                if (typeof evaluatedLoopVarName.value !== 'string') {
                    throw new EvaluationError(`Variable name must evaluate to a string, but was ${JSON.stringify(evaluatedLoopVarName.value)}`);
                }
                result.evaluatedVariables.push(...evaluatedLoopVarName.evaluatedVariables);
                result.variableReferences.push(...evaluatedLoopVarName.variableReferences);

                // Evaluate the function body.

                const definition = context.scopeStack.createVariableDefinition(loopVarRange);
                const arrayItems = evaluatedArrayToLoopOver.valueScopeVariable.value;
                if (!(arrayItems instanceof Array)) {
                    throw new EvaluationError(`'ForEach' variable to loop over must be an array`);
                }

                context.scopeStack.push();
                for (const arrayItem of arrayItems) {
                    const variable = context.scopeStack.setVariableInCurrentScope(evaluatedLoopVarName.value, arrayItem, definition);

                    // The loop variable is a variable reference.
                    result.variableReferences.push({
                        definition: variable.definition,
                        range: loopVarRange,
                        usingRange: null,
                    });

                    const evaluatedStatements = evaluateStatements(statement.statements, context);
                    result.evaluatedVariables.push(...evaluatedStatements.evaluatedVariables);
                    result.variableReferences.push(...evaluatedStatements.variableReferences);
                    for (const [varName, varDefinition] of evaluatedStatements.variableDefinitions) {
                        result.variableDefinitions.set(varName, varDefinition);
                    }
                }
                context.scopeStack.pop();

                break;
            }
            case 'genericFunction': {
                // Evaluate the alias.
                const alias: any = statement.alias;
                const evaluatedAliasName = evaluateRValue(alias, context);
                if (typeof evaluatedAliasName.value !== 'string') {
                    throw new EvaluationError(`Alias must evaluate to a string, but was ${JSON.stringify(evaluatedAliasName.value)}`);
                }
                result.evaluatedVariables.push(...evaluatedAliasName.evaluatedVariables);
                result.variableReferences.push(...evaluatedAliasName.variableReferences);

                // Evaluate the function body.
                context.scopeStack.push();
                const evaluatedStatements = evaluateStatements(statement.statements, context);
                result.evaluatedVariables.push(...evaluatedStatements.evaluatedVariables);
                result.variableReferences.push(...evaluatedStatements.variableReferences);
                for (const [varName, varDefinition] of evaluatedStatements.variableDefinitions) {
                    result.variableDefinitions.set(varName, varDefinition);
                }
                context.scopeStack.pop();

                break;
            }
            case 'error': {
                const value: any = statement.value;
                const evaluatedValue = evaluateRValue(value, context);
                if (typeof evaluatedValue.value !== 'string') {
                    throw new EvaluationError(`Value must evaluate to a string, but was ${JSON.stringify(evaluatedValue.value)}`);
                }
                result.evaluatedVariables.push(...evaluatedValue.evaluatedVariables);
                result.variableReferences.push(...evaluatedValue.variableReferences);
                break;
            }
            case 'print': {
                const value: any = statement.value;
                const evaluatedValue = evaluateRValue(value, context);
                if (typeof evaluatedValue.value !== 'string') {
                    throw new EvaluationError(`Value must evaluate to a string, but was ${JSON.stringify(evaluatedValue.value)}`);
                }
                result.evaluatedVariables.push(...evaluatedValue.evaluatedVariables);
                result.variableReferences.push(...evaluatedValue.variableReferences);
                break;
            }
            case 'settings': {                
                // Evaluate the function body.
                context.scopeStack.push();
                const evaluatedStatements = evaluateStatements(statement.statements, context);
                result.evaluatedVariables.push(...evaluatedStatements.evaluatedVariables);
                result.variableReferences.push(...evaluatedStatements.variableReferences);
                for (const [varName, varDefinition] of evaluatedStatements.variableDefinitions) {
                    result.variableDefinitions.set(varName, varDefinition);
                }
                context.scopeStack.pop();
                break;
            }
            case 'if': {
                // Evaluate the condition.
                const condition = statement.condition;
                let evaluatedConditionBool = false;
                switch (condition.type) {
                    case 'boolean': {
                        if (condition.value.type !== 'evaluatedVariable') {
                            throw new EvaluationError(`'If' condition must be an evaluated variable but instead is '${condition.value.type}'`);
                        }
                        const conditionValue: ParsedEvaluatedVariable = condition.value;
                        const evaluatedCondition = evaluateEvaluatedVariable(conditionValue, context);
                        const evaluatedConditionValue = evaluatedCondition.valueScopeVariable.value;
                        if (typeof evaluatedConditionValue !== 'boolean') {
                            throw new EvaluationError(`Condition must evaluate to a boolean, but was ${typeof evaluatedConditionValue} (${JSON.stringify(evaluatedConditionValue)})`);
                        }
                        result.evaluatedVariables.push(...evaluatedCondition.evaluatedVariables);
                        result.variableReferences.push(...evaluatedCondition.variableReferences);

                        evaluatedConditionBool = condition.invert ? !evaluatedConditionValue : evaluatedConditionValue;
                        break;
                    }
                    case 'comparison': {
                        // Evaluate LHS.
                        if (condition.lhs.type !== 'evaluatedVariable') {
                            throw new EvaluationError(`'If' condition must be an evaluated variable but instead is '${condition.lhs.type}'`);
                        }
                        const lhs: ParsedEvaluatedVariable = condition.lhs;
                        const evaluatedLhs = evaluateEvaluatedVariable(lhs, context);
                        const evaluatedLhsValue = evaluatedLhs.valueScopeVariable.value;
                        result.evaluatedVariables.push(...evaluatedLhs.evaluatedVariables);
                        result.variableReferences.push(...evaluatedLhs.variableReferences);
                        
                        // Evaluate RHS.
                        if (condition.rhs.type !== 'evaluatedVariable') {
                            throw new EvaluationError(`'If' condition must be an evaluated variable but instead is '${condition.rhs.type}'`);
                        }
                        const rhs: ParsedEvaluatedVariable = condition.rhs;
                        const evaluatedRhs = evaluateEvaluatedVariable(rhs, context);
                        const evaluatedRhsValue = evaluatedRhs.valueScopeVariable.value;
                        result.evaluatedVariables.push(...evaluatedRhs.evaluatedVariables);
                        result.variableReferences.push(...evaluatedRhs.variableReferences);

                        if (typeof evaluatedLhsValue !== typeof evaluatedRhsValue) {
                            throw new EvaluationError(`'If' condition comparison must compare variables of the same type, but got '${typeof evaluatedLhsValue}' and '${typeof evaluatedRhsValue}'`);
                        }

                        const operator: string = condition.operator;
                        
                        // Only allow '==' and '!=' operators for booleans, since {'>', '>=', '<', '<='} don't make sense.
                        // Checking the LHS type also implicitly checks the RHS type since above we checked that the LHS and RHS types are equal.
                        if (typeof evaluatedLhsValue === 'boolean'
                            && operator !== '=='
                            && operator !== '!=')
                        {
                            throw new EvaluationError(`'If' comparison of booleans only supports '==' and '!=', but '${operator}' was used`);
                        }

                        switch (operator) {
                            case '==':
                                evaluatedConditionBool = evaluatedLhsValue == evaluatedRhsValue;
                                break;
                            case '!=':
                                evaluatedConditionBool = evaluatedLhsValue != evaluatedRhsValue;
                                break;
                            case '<':
                                evaluatedConditionBool = evaluatedLhsValue < evaluatedRhsValue;
                                break;
                            case '<=':
                                evaluatedConditionBool = evaluatedLhsValue <= evaluatedRhsValue;
                                break;
                            case '>':
                                evaluatedConditionBool = evaluatedLhsValue > evaluatedRhsValue;
                                break;
                            case '>=':
                                evaluatedConditionBool = evaluatedLhsValue >= evaluatedRhsValue;
                                break;
                            default:
                                throw new EvaluationError(`Unknown 'If' comparison operator '${operator}'`);
                        }
                        break;
                    }
                    case 'in': {
                        // Evaluate LHS.
                        if (condition.lhs.type !== 'evaluatedVariable') {
                            throw new EvaluationError(`'If' condition must be an evaluated variable but instead is '${condition.lhs.type}'`);
                        }
                        const lhs: ParsedEvaluatedVariable = condition.lhs;
                        const evaluatedLhs = evaluateEvaluatedVariable(lhs, context);
                        const evaluatedLhsValue = evaluatedLhs.valueScopeVariable.value;
                        result.evaluatedVariables.push(...evaluatedLhs.evaluatedVariables);
                        result.variableReferences.push(...evaluatedLhs.variableReferences);
                        
                        // Evaluate RHS.
                        if (condition.rhs.type !== 'evaluatedVariable') {
                            throw new EvaluationError(`'If' condition must be an evaluated variable but instead is '${condition.rhs.type}'`);
                        }
                        const rhs: ParsedEvaluatedVariable = condition.rhs;
                        const evaluatedRhs = evaluateEvaluatedVariable(rhs, context);
                        const evaluatedRhsValue = evaluatedRhs.valueScopeVariable.value;
                        result.evaluatedVariables.push(...evaluatedRhs.evaluatedVariables);
                        result.variableReferences.push(...evaluatedRhs.variableReferences);

                        // Check presence.
                        if (evaluatedRhsValue instanceof Array) {
                            if (evaluatedRhsValue.length === 0) {
                                evaluatedConditionBool = false;
                            } else if (typeof evaluatedRhsValue[0] === 'string') {
                                if (typeof evaluatedLhsValue === 'string') {
                                    evaluatedConditionBool = evaluatedRhsValue.includes(evaluatedLhsValue);
                                } else if (evaluatedLhsValue instanceof Array) {
                                    if (evaluatedLhsValue.length === 0) {
                                        evaluatedConditionBool = false;
                                    } else if (typeof evaluatedLhsValue[0] === 'string') {
                                        evaluatedConditionBool = evaluatedLhsValue.some(searchString => evaluatedRhsValue.includes(searchString));
                                    } else {
                                        throw new EvaluationError(`'If' 'in' condition left-hand-side variable must be either a string or an array of strings, but got an array of '${typeof evaluatedLhsValue[0]}'`);
                                    }
                                } else {
                                    throw new EvaluationError(`'If' 'in' condition left-hand-side variable must be either a string or an array of strings, but got '${JSON.stringify(evaluatedLhsValue)}'`);
                                }
                            } else {
                                throw new EvaluationError(`'If' 'in' condition right-hand-side variable must be an array of strings, but got an array of '${typeof evaluatedRhsValue[0]}'`);
                            }
                        } else {
                            throw new EvaluationError(`'If' 'in' condition right-hand-side variable must be an array of strings, but got '${JSON.stringify(evaluatedRhsValue)}'`);
                        }

                        const invert: boolean = condition.invert;
                        if (invert) {
                            evaluatedConditionBool = !evaluatedConditionBool;
                        }

                        break;
                    }
                    default:
                        throw new EvaluationError(`Unknown condition type '${condition.type}'`);
                }

                // Evaluate the function body if the condition was true.
                if (evaluatedConditionBool === true) {
                    context.scopeStack.push();
                    const evaluatedStatements = evaluateStatements(statement.statements, context);
                    result.evaluatedVariables.push(...evaluatedStatements.evaluatedVariables);
                    result.variableReferences.push(...evaluatedStatements.variableReferences);
                    for (const [varName, varDefinition] of evaluatedStatements.variableDefinitions) {
                        result.variableDefinitions.set(varName, varDefinition);
                    }
                    context.scopeStack.pop();
                }
                break;
            }
            case 'include': {
                const includeRelativePath: Uri = statement.path;
                const thisFbuildUriDir = vscodeUri.Utils.dirname(vscodeUri.URI.parse(context.thisFbuildUri));
                const includeUri = vscodeUri.Utils.resolvePath(thisFbuildUriDir, includeRelativePath).toString();
                const includeParseData = context.parseDataProvider.getParseData(includeUri);

                const evaluatedStatements = evaluateStatements(
                    includeParseData.statements,
                    {
                        scopeStack: context.scopeStack,
                        thisFbuildUri: includeUri,
                        parseDataProvider: context.parseDataProvider,
                    }
                );

                result.evaluatedVariables.push(...evaluatedStatements.evaluatedVariables);
                result.variableReferences.push(...evaluatedStatements.variableReferences);
                for (const [varName, varDefinition] of evaluatedStatements.variableDefinitions) {
                    result.variableDefinitions.set(varName, varDefinition);
                }

                break;
            }
            default:
                throw new EvaluationError(`Unknown statement type '${statement.type}' from statement ${JSON.stringify(statement)}`);
        }
    }

    return result;
}

function evaluateRValue(rValue: any, context: EvaluationContext): EvaluatedRValue {
    if (rValue.type && rValue.type == 'stringExpression') {
        const evaluated = evaluateStringExpression(rValue.parts, context);
        return {
            value: evaluated.evaluatedString,
            evaluatedVariables: evaluated.evaluatedVariables,
            variableReferences: evaluated.variableReferences,
            variableDefinitions: new Map<string, VariableDefinition>(),
        };
    } else if (rValue.type && rValue.type == 'struct') {
        return evaluateStruct(rValue.statements, context);
    } else if (rValue.type && rValue.type == 'sum') {
        return evaluateSum(rValue.summands, context);
    } else if (rValue.type && rValue.type == 'evaluatedVariable') {
        const evaluated = evaluateEvaluatedVariable(rValue, context);
        return {
            value: evaluated.valueScopeVariable.value,
            evaluatedVariables: evaluated.evaluatedVariables,
            variableReferences: evaluated.variableReferences,
            variableDefinitions: new Map<string, VariableDefinition>(),
        };
    } else if (rValue instanceof Array) {
        const result: EvaluatedRValue = {
            value: [],
            evaluatedVariables: [],
            variableReferences: [],
            variableDefinitions: new Map<string, VariableDefinition>(),
        };
        result.value = [];
        for (const item of rValue) {
            const evaluated = evaluateRValue(item, context);
            result.value.push(evaluated.value);
            result.evaluatedVariables.push(...evaluated.evaluatedVariables);
            result.variableReferences.push(...evaluated.variableReferences);
            for (const [varName, varDefinition] of evaluated.variableDefinitions) {
                result.variableDefinitions.set(varName, varDefinition);
            }
        }
        return result;
    } else {
        // Primitive (boolean | number | string)
        return {
            value: rValue,
            evaluatedVariables: [],
            variableReferences: [],
            variableDefinitions: new Map<string, VariableDefinition>(),
        };
    }
}

function evaluateEvaluatedVariable(parsedEvaluatedVariable: ParsedEvaluatedVariable, context: EvaluationContext): EvaluatedEvaluatedVariable {
    const evaluatedVariableName = evaluateRValue(parsedEvaluatedVariable.name, context);
    if (typeof evaluatedVariableName.value !== 'string') {
        throw new EvaluationError(`Variable name must evaluate to a string, but was ${JSON.stringify(evaluatedVariableName.value)}`);
    }

    const evaluatedVariables = evaluatedVariableName.evaluatedVariables;
    const variableReferences = evaluatedVariableName.variableReferences;
    
    const valueScopeVariable = (parsedEvaluatedVariable.scope == 'current')
        ? context.scopeStack.getVariableStartingFromCurrentScope(evaluatedVariableName.value)
        : context.scopeStack.getVariableInParentScope(evaluatedVariableName.value);

    const parsedEvaluatedVariableRange = new SourceRange(context.thisFbuildUri, parsedEvaluatedVariable.range);

    evaluatedVariables.push({
        value: valueScopeVariable.value,
        range: parsedEvaluatedVariableRange,
    });

    variableReferences.push({
        definition: valueScopeVariable.definition,
        usingRange: valueScopeVariable.usingRange,
        range: parsedEvaluatedVariableRange,
    });

    return {
        valueScopeVariable,
        evaluatedVariables,
        variableReferences,
    };
}

// `parts` is an array of either strings or `evaluatedVariable` parse-data.
function evaluateStringExpression(parts: (string | any)[], context: EvaluationContext): EvaluatedStringExpression {
    const result: EvaluatedStringExpression = {
        evaluatedString: '',
        evaluatedVariables: [],
        variableReferences: [],
    };

    for (const part of parts) {
        if (part.type && part.type == 'evaluatedVariable') {
            const evaluated = evaluateEvaluatedVariable(part, context);
            result.evaluatedString += String(evaluated.valueScopeVariable.value);
            result.evaluatedVariables.push(...evaluated.evaluatedVariables);
            result.variableReferences.push(...evaluated.variableReferences);
        } else {
            // Literal
            result.evaluatedString += part;
        }
    }

    return result;
}

function evaluateStruct(statements: Statement[], context: EvaluationContext): EvaluatedRValue {
    context.scopeStack.push();
    const evaluatedStatements = evaluateStatements(statements, context);
    const structScope: Scope = context.scopeStack.getCurrentScope();
    context.scopeStack.pop();

    const evaluatedValue = new Struct();
    for (const [name, variable] of structScope.variables) {
        //variable.definition.id
        evaluatedValue.set(name, variable.value);
    }

    return {
        value: evaluatedValue,
        evaluatedVariables: evaluatedStatements.evaluatedVariables,
        variableReferences: evaluatedStatements.variableReferences,
        variableDefinitions: evaluatedStatements.variableDefinitions,
    };
}

function evaluateSum(summands: Value[], context: EvaluationContext): EvaluatedRValue {
    if (summands.length < 2) {
        throw new EvaluationError("A sum must have at least 2 summands. Summands: ${summands}");
    }

    const result = evaluateRValue(summands[0], context);
    // Copy the value so that we don't modify the EvaluatedVariable which references it when we add to it.
    result.value = deepCopyValue(result.value);

    for (const summand of summands.slice(1)) {
        const evaluatedSummand = evaluateRValue(summand, context);
        result.value = inPlaceAdd(result.value, evaluatedSummand.value);
        result.evaluatedVariables.push(...evaluatedSummand.evaluatedVariables);
        result.variableReferences.push(...evaluatedSummand.variableReferences);
        for (const [varName, varDefinition] of evaluatedSummand.variableDefinitions) {
            result.variableDefinitions.set(varName, varDefinition);
        }
    }

    return result;
}

// In-place add summand to existingValue, and return it.
function inPlaceAdd(existingValue: Value, summand: Value): Value {
    if (existingValue instanceof Array) {
        if (summand instanceof Array) {
            existingValue.push(...summand);
        } else {
            existingValue.push(summand);
        }
    } else if ((existingValue instanceof Map) && (summand instanceof Map)) {
        for (const [key, value] of summand.entries()) {
            existingValue.set(key, value);
        }
    } else if ((typeof existingValue == 'string') && (typeof summand == 'string')) {
        existingValue += summand;
    } else if ((typeof existingValue == 'number') && (typeof summand == 'number')) {
        existingValue += summand;
    } else {
        throw new EvaluationError(`Cannot add a ${typeof summand} (${JSON.stringify(summand)}) to a ${typeof existingValue} (${JSON.stringify(existingValue)}).`);
    }

    return existingValue;
}

function deepCopyValue(value: Value): Value {
    if (value instanceof Array) {
        const copy = [];
        for (let i = 0, len = value.length; i < len; i++) {
            copy[i] = deepCopyValue(value[i]);
        }
        return copy;
    } else if (value instanceof Struct) {
        const copy = new Struct();
        for (const [itemKey, itemValue] of value.entries()) {
            copy.set(itemKey, deepCopyValue(itemValue));
        }
        return copy;
    } else {
        return value;
    }
}