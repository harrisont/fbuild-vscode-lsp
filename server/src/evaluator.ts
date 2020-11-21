import * as parser from './parser'

export class EvaluationError extends Error {
	constructor(message?: string) {
		super(message);
		Object.setPrototypeOf(this, new.target.prototype);
		this.name = EvaluationError.name;
	}
}

export interface SourceRange
{
	line: number,
	characterStart: number,
	characterEnd: number
}

export type Value = boolean | number | string | Value[];

export interface EvaluatedVariable
{
	range: SourceRange
	value: Value
}

export interface ParsedData {
	evaluatedVariables: EvaluatedVariable[]
}

type ScopeLocation = 'current' | 'parent';

interface VariableDefinitionLhs {
	name: string,
	scope: ScopeLocation
}

interface GrammarEvaluatedVariable {
	type: 'evaluatedVariable',
	name: string,
	scope: ScopeLocation,
	line: number,
	characterStart: number,
	characterEnd: number,
}

interface ParsedStringExpression {
	evaluatedString: string,
	evaluatedVariables: EvaluatedVariable[],
}

interface ParsedEvaluatedVariable {
	evaluatedValue: Value,
	evaluatedVariable: EvaluatedVariable,
}

interface Scope {
	variables: Map<string, Value>
}

class ScopeStack {
	private stack: Array<Scope> = []

	constructor() {
		this.push();
	}

	push() {
		let scope: Scope = {
			variables: new Map<string, Value>()
		}

		this.stack.push(scope);
	}

	pop() {
		if (this.stack.length < 2) {
			throw new EvaluationError('Cannot pop scope because there is no parent scope.');
		}
		this.stack.pop();
	}

	// Get a variable value, searching from the current scope to its parents.
	// Throw ParseError if the variable is not defined.
	getVariableValueStartingFromCurrentScope(variableName: string): Value {
		for (let scopeIndex = this.stack.length - 1; scopeIndex >= 0; --scopeIndex) {
			const scope = this.stack[scopeIndex];
			const maybeValue = scope.variables.get(variableName);
			if (maybeValue !== undefined) {
				return maybeValue;
			}
		}
		throw new EvaluationError(`Referencing variable "${variableName}" that is undefined in the current scope or any of the parent scopes.`);
	}

	// Throw ParseError if the variable is not defined.
	getVariableValueInCurrentScope(variableName: string): Value {
		const currentScope = this.getCurrentScope();
		const maybeValue = currentScope.variables.get(variableName);
		if (maybeValue === undefined) {
			throw new EvaluationError(`Referencing varable "${variableName}" that is undefined in the current scope.`);
		} else {
			return maybeValue;
		}
	}

	// Throw ParseError if the variable is not defined.
	getVariableValueInParentScope(variableName: string): Value {
		const parentScope = this.getParentScope();
		const maybeValue = parentScope.variables.get(variableName);
		if (maybeValue === undefined) {
			throw new EvaluationError(`Referencing varable "${variableName}" that is undefined in the parent scope.`);
		} else {
			return maybeValue;
		}
	}

	setVariableInCurrentScope(name: string, value: Value): void {
		const currentScope = this.getCurrentScope();
		currentScope.variables.set(name, value);
	}

	updateExistingVariableInParentScope(name: string, value: Value): void {
		const parentScope = this.getParentScope();
		if (parentScope.variables.get(name) === undefined) {
			throw new EvaluationError(`Cannot update variable "${name}" in parent scope because the variable does not exist in the parent scope.`);
		}
		parentScope.variables.set(name, value);
	}

	private getCurrentScope(): Scope {
		return this.stack[this.stack.length - 1];
	}

	private getParentScope(): Scope {
		if (this.stack.length < 2) {
			throw new EvaluationError(`Cannot access parent scope because there is no parent scope.`);
		}
		return this.stack[this.stack.length - 2];
	}
}

export function evaluate(input: string): ParsedData {
	const statements = parser.parse(input);

	let evaluatedVariables: EvaluatedVariable[] = [];

	let scopeStack = new ScopeStack();

	for (const statement of statements) {
		switch (statement.type) {
			case 'variableDefinition': {
				const rhs = statement.rhs;
				let evaluatedRhs: Value;
				if (rhs.type && rhs.type == 'stringExpression') {
					const parsedStringExpression = parseStringExpression(rhs.parts, scopeStack);
					evaluatedRhs = parsedStringExpression.evaluatedString;
					evaluatedVariables.push(...parsedStringExpression.evaluatedVariables);
				} else if (rhs.type && rhs.type == 'evaluatedVariable') {
					const parsed = parseEvaluatedVariable(rhs, scopeStack);
					evaluatedRhs = parsed.evaluatedValue;
					evaluatedVariables.push(parsed.evaluatedVariable);
				} else {
					evaluatedRhs = rhs;
				}

				const lhs: VariableDefinitionLhs = statement.lhs;
				if (lhs.scope == 'current') {
					scopeStack.setVariableInCurrentScope(lhs.name, evaluatedRhs);
				} else {
					scopeStack.updateExistingVariableInParentScope(lhs.name, evaluatedRhs);
				}
				break;
			}
			case 'variableAddition': {
				const rhs = statement.rhs;
				let evaluatedRhs: Value;
				if (rhs.type && rhs.type == 'stringExpression') {
					const parsedStringExpression = parseStringExpression(rhs.parts, scopeStack);
					evaluatedRhs = parsedStringExpression.evaluatedString;
					evaluatedVariables.push(...parsedStringExpression.evaluatedVariables);
				} else if (rhs.type && rhs.type == 'evaluatedVariable') {
					const parsed = parseEvaluatedVariable(rhs, scopeStack);
					evaluatedRhs = parsed.evaluatedValue;
					evaluatedVariables.push(parsed.evaluatedVariable);
				} else {
					evaluatedRhs = rhs;
				}

				const lhs: VariableDefinitionLhs = statement.lhs;
				if (lhs.scope == 'current') {
					const existingValue = scopeStack.getVariableValueInCurrentScope(lhs.name);
					// Can only add strings and arrays.
					if (existingValue instanceof Array) {
						existingValue.push(evaluatedRhs);
					} else if ((typeof existingValue == 'string') && (typeof evaluatedRhs == 'string')) {
						const sum = existingValue + evaluatedRhs;
						scopeStack.setVariableInCurrentScope(lhs.name, sum);
					} else {
						throw new EvaluationError(`Cannot add incompatible types: LHS=${typeof existingValue}, RHS=${typeof evaluatedRhs}.`);
					}
				} else {
					const existingValue = scopeStack.getVariableValueInParentScope(lhs.name);
					// Can only add strings and arrays.
					if (existingValue instanceof Array) {
						existingValue.push(evaluatedRhs);
					} else if ((typeof existingValue == 'string') && (typeof evaluatedRhs == 'string')) {
						const sum = existingValue + evaluatedRhs;
						scopeStack.updateExistingVariableInParentScope(lhs.name, sum);
					} else {
						throw new EvaluationError(`Cannot add incompatible types: LHS=${typeof existingValue}, RHS=${typeof evaluatedRhs}.`);
					}
				}
				break;
			}
			case 'scopeStart':
				scopeStack.push();
				break;
			case 'scopeEnd':
				scopeStack.pop();
				break;
		}
	}
	
	return {
		evaluatedVariables: evaluatedVariables
	};
}

function parseEvaluatedVariable(variable: GrammarEvaluatedVariable, scopeStack: ScopeStack): ParsedEvaluatedVariable {
	const variableName: string = variable.name;
	const variableValue = (variable.scope == 'current')
							? scopeStack.getVariableValueStartingFromCurrentScope(variableName)
							: scopeStack.getVariableValueInParentScope(variableName);
	return {
		evaluatedValue: variableValue,
		evaluatedVariable: {
			value: variableValue,
			range: {
				line: variable.line,
				characterStart: variable.characterStart,
				characterEnd: variable.characterEnd,
			}
		}
	};
}

// `parts` is an array of either strings or `evaluatedVariable` parse-data.
function parseStringExpression(parts: (string | any)[], scopeStack: ScopeStack): ParsedStringExpression {
	let result: ParsedStringExpression = {
		evaluatedString: '',
		evaluatedVariables: [],
	};
	
	for (const part of parts) {
		if (part.type && part.type == 'evaluatedVariable') {
			const parsed = parseEvaluatedVariable(part, scopeStack);
			result.evaluatedString += String(parsed.evaluatedValue);
			result.evaluatedVariables.push(parsed.evaluatedVariable);
		} else {
			// Literal
			result.evaluatedString += part;
		}
	}

	return result;
}