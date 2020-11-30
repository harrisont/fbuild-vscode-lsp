import * as assert from 'assert';

import {
    SourceRange,
} from '../parser';

import {
    evaluate,
    EvaluatedData,
    EvaluatedVariable,
    Struct,
    Value,
    VariableReference,
} from '../evaluator';

function createRange(startLine: number, startCharacter: number, endLine: number, endCharacter: number): SourceRange {
    return {
        start: {
            line: startLine,
            character: startCharacter
        },
        end: {
            line: endLine,
            character: endCharacter
        }
    };
}

// Compares the parsed evaluatedVariables, but only the value, not the range.
function assertEvaluatedVariablesValueEqual(input: string, expectedValues: Value[]): void {
    const result: EvaluatedData = evaluate(input);
    const actualValues = result.evaluatedVariables.map(evaluatedVariable => evaluatedVariable.value);
    assert.deepStrictEqual(actualValues, expectedValues);
}

describe('evaluator', () => {
    describe('evaluatedVariables value', () => {
        it('should be detected in a string with a variable', () => {
            const input = `
                .MyVar = 'MyValue'
                .Evaluated = 'pre-$MyVar$-post'
            `;
            assertEvaluatedVariablesValueEqual(input, ['MyValue']);
        });

        it('should be detected in a string with multiple variables', () => {
            const input = `
                .MyVar1 = 'MyValue1'
                .MyVar2 = 'MyValue2'
                .Evaluated = 'pre-$MyVar1$-$MyVar2$-post'
            `;
            assertEvaluatedVariablesValueEqual(input, ['MyValue1', 'MyValue2']);
        });

        it('should be detected in the RHS when assigning the value of another variable', () => {
            const input = `
                .MyVar = 1
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [1]);
        });

        it('should be detected in the RHS when assigning the value of another variable in the parent scope', () => {
            const input = `
                .MyVar = 1
                {
                    .Copy = ^MyVar
                }
            `;
            assertEvaluatedVariablesValueEqual(input, [1]);
        });

        it('should be able to read a variable in a direct parent scope', () => {
            const input = `
                .Var1 = 1
                {
                    .Var2 = .Var1
                }
            `;
            assertEvaluatedVariablesValueEqual(input, [1]);
        });
        
        it('should be able to read a variable in a grandparent scope', () => {
            const input = `
                .Var1 = 1
                {
                    {
                        .Var2 = .Var1
                    }
                }
            `;
            assertEvaluatedVariablesValueEqual(input, [1]);
        });

        it('should allow variables with the same name in different scopes', () => {
            const input = `
                {
                    .Var1 = 1
                    .Var2 = .Var1
                }
                {
                    .Var1 = 2
                    .Var2 = .Var1
                }
            `;
            assertEvaluatedVariablesValueEqual(input, [1, 2]);
        });

        it('should allow a variable to shadow a variable with the same name in a parent scope', () => {
            const input = `
                .Var = 1
                {
                    .Var = 2
                    .Inner = .Var
                }
                .Outer = .Var
            `;
            assertEvaluatedVariablesValueEqual(input, [2, 1]);
        });

        it('should not be able to read a variable in a child scope', () => {
            const input = `
                {
                    .Var1 = 1
                }
                .Var2 = .Var1
            `;
            assert.throws(
                () => evaluate(input),
                {
                    name: 'EvaluationError',
                    message: 'Referencing variable "Var1" that is undefined in the current scope or any of the parent scopes.'
                }
            );
        });

        it('should be able to write an existing variable in a direct parent scope', () => {
            const input = `
                .Var1 = 1
                {
                    ^Var1 = 2
                }
                .Var2 = .Var1
            `;
            assertEvaluatedVariablesValueEqual(input, [2]);
        });

        it('should not be able to write a non-existant variable in a parent scope', () => {
            const input = `
                {
                    ^Var1 = 1
                }
            `;
            assert.throws(
                () => evaluate(input),
                {
                    name: 'EvaluationError',
                    message: 'Cannot update variable "Var1" in parent scope because the variable does not exist in the parent scope.'
                }
            );
        });

        it('should not be able to write a variable in a grandparent scope', () => {
            const input = `
                .Var1 = 1
                {
                    {
                        ^Var1 = 2
                    }
                }
            `;
            assert.throws(
                () => evaluate(input),
                {
                    name: 'EvaluationError',
                    message: 'Cannot update variable "Var1" in parent scope because the variable does not exist in the parent scope.'
                }
            );
        });

        it('should work on adding an integer', () => {
            const input = `
                .MySum = 1
                .MySum + 2
                .Evaluated = .MySum
            `;
            assertEvaluatedVariablesValueEqual(input, [3]);
        });

        it('should work on adding a string literal', () => {
            const input = `
                .MyMessage = 'hello'
                .MyMessage + ' world'
                .Evaluated = .MyMessage
            `;
            assertEvaluatedVariablesValueEqual(input, ['hello world']);
        });

        it('should work on adding a string literal to a variable in the parent scope', () => {
            const input = `
                .MyMessage = 'hello'
                {
                    ^MyMessage + ' world'
                }
                .Evaluated = .MyMessage
            `;
            assertEvaluatedVariablesValueEqual(input, ['hello world']);
        });

        it('should work on adding a string with a variable', () => {
            const input = `
                .MyName = 'Bobo'
                .MyMessage = 'hello'
                .MyMessage + .MyName
                .Evaluated = .MyMessage
            `;
            assertEvaluatedVariablesValueEqual(input, ['Bobo', 'helloBobo']);
        });

        it('should work on adding a string with a string template', () => {
            const input = `
                .MyName = 'Bobo'
                .MyMessage = 'hello'
                .MyMessage + ' $MyName$'
                .Evaluated = .MyMessage
            `;
            assertEvaluatedVariablesValueEqual(input, ['Bobo', 'hello Bobo']);
        });

        it('adding a string literal should use the last referenced variable if none is specified', () => {
            const input = `
                .MyMessage = 'hello'
                            + ' world'
                .Evaluated = .MyMessage
            `;
            assertEvaluatedVariablesValueEqual(input, ['hello world']);
        });

        it('adding mulitple string literals should use the last referenced variable if none is specified', () => {
            const input = `
                .MyMessage = 'hello'
                        + ' world'
                        + '!'
                .Evaluated = .MyMessage
            `;
            assertEvaluatedVariablesValueEqual(input, ['hello world!']);
        });

        it('adding an evaluated variable should use the last referenced variable if none is specified', () => {
            const input = `
                .MyVar = 'world'
                .MyMessage = 'hello '
                        + .MyVar
                .Evaluated = .MyMessage
            `;
            assertEvaluatedVariablesValueEqual(input, ['world', 'hello world']);
        });

        it('adding mulitple evaluated variables should use the last referenced variable if none is specified', () => {
            const input = `
                .MyVar1 = 'world'
                .MyVar2 = '!'
                .MyMessage = 'hello '
                        + .MyVar1
                        + .MyVar2
                .Evaluated = .MyMessage
            `;
            assertEvaluatedVariablesValueEqual(input, ['world', '!', 'hello world!']);
        });

        it('should work on adding a string literal to a variable in the parent scope', () => {
            const input = `
                .MyMessage = 'hello'
                {
                    ^MyMessage + ' world'
                    .Evaluated1 = .MyMessage
                }
                .Evaluated2 = .MyMessage
            `;
            assertEvaluatedVariablesValueEqual(input, ['hello world', 'hello world']);
        });

        it('should fail when adding a string to a variable not in scope (current scope)', () => {
            const input = `
                .MyMessage = 'hello'
                {
                    .MyMessage + ' world'
                }
            `;
            assert.throws(
                () => evaluate(input),
                {
                    name: 'EvaluationError',
                    message: 'Referencing varable "MyMessage" that is undefined in the current scope.'
                }
            );
        });

        it('should fail when adding a string to a variable not in scope (parent scope)', () => {
            const input = `
                {
                    ^MyMessage + ' world'
                }
            `;
            assert.throws(
                () => evaluate(input),
                {
                    name: 'EvaluationError',
                    message: 'Referencing varable "MyMessage" that is undefined in the parent scope.'
                }
            );
        });

        it('should work on adding an item to an array', () => {
            const input = `
                .MyVar = {}
                .MyVar + 'cow'
                .Result = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [['cow']]);
        });

        it('should correctly evaulate an empty string literal', () => {
            const input = `
                .MyVar = ''
                .Result = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, ['']);
        });
    
        it('should evaluate an empty array', () => {
            const input = `
                .MyVar = {}
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [
                []
            ]);
        });
    
        it('should evaluate an array of string literals', () => {
            const input = `
                .MyVar = {
                    'thing1'
                    'thing2'
                }
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [
                ['thing1', 'thing2']
            ]);
        });
    
        it('should evaluate an array of string templates', () => {
            const input = `
                .Type = 'thing'
                .MyVar = {
                    '$Type$1'
                    '$Type$2'
                }
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [
                'thing',
                'thing',
                ['thing1', 'thing2']
            ]);
        });
    
        it('should evaluate an array of evaluated variables', () => {
            const input = `
                .Var1 = 'thing1'
                .Var2 = 'thing2'
                .MyVar = {
                    .Var1
                    .Var2
                }
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [
                'thing1',
                'thing2',
                ['thing1', 'thing2']
            ]);
        });
    
        it('should evaluate an array with just comments', () => {
            const input = `
                .MyVar = {
                    // Some comment
                }
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [
                []
            ]);
        });
    
        it('should evaluate an array with comments and items', () => {
            const input = `
                .MyVar = {
                    'a'
                    // 2nd letter
                    'b'
                    // ...and so on...
                }
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [
                ['a', 'b']
            ]);
        });

        it('should evaluate an empty struct', () => {
            const input = `
                .MyVar = []
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [
                new Struct()
            ]);
        });
    
        it('should evaluate a basic struct', () => {
            const input = `
                .MyVar = [
                    .MyBool = true
                    .MyInt = 123
                    .MyStr = 'Hello world!'
                ]
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [
                new Struct(Object.entries({
                    MyBool: true,
                    MyInt: 123,
                    MyStr: 'Hello world!'
                }))
            ]);
        });

        it('should evaluate a struct with an evaluated variable', () => {
            const input = `
                .B = 1
                .MyVar = [
                    .A = .B
                ]
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [
                1,
                new Struct(Object.entries({
                    A: 1
                }))
            ]);
        });

        it('should evaluate a struct with multiple evaluated variables', () => {
            const input = `
                .B1 = 1
                .B2 = 2
                .MyVar = [
                    .A1 = .B1
                    .A2 = .B2
                ]
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [
                1,
                2,
                new Struct(Object.entries({
                    A1: 1,
                    A2: 2
                }))
            ]);
        });
    
        it('should evaluate a struct containing an array', () => {
            const input = `
                .MyVar = [
                    .MyArray = {1, 2, 3}
                ]
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [
                new Struct(Object.entries({
                    MyArray: [1, 2, 3]
                }))
            ]);
        });
    
        it('should evaluate a struct containing a struct', () => {
            const input = `
                .MyVar = [
                    .MyStruct = [
                        .MyInt = 1
                    ]
                ]
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [
                new Struct(Object.entries({
                    MyStruct: new Struct(Object.entries({
                        MyInt: 1
                    }))
                }))
            ]);
        });
    
        it('should evaluate an array of structs', () => {
            const input = `
                .Struct1 = [.MyInt = 1]
                .Struct2 = [.MyInt = 2]
                .MyVar = {
                    .Struct1
                    .Struct2
                }
                .Copy = .MyVar
            `;
            assertEvaluatedVariablesValueEqual(input, [
                new Struct(Object.entries({
                    MyInt: 1,
                })),
                new Struct(Object.entries({
                    MyInt: 2,
                })),
                [
                    new Struct(Object.entries({
                        MyInt: 1,
                    })),
                    new Struct(Object.entries({
                        MyInt: 2,
                    }))
                ]
            ]);
        });
    });

    describe('evaluatedVariables range', () => {
        it('should be detected in a string with multiple variables', () => {
            const input = `
                .MyVar1 = 'MyValue1'
                .MyVar2 = 'MyValue2'
                .Evaluated = 'pre-$MyVar1$-$MyVar2$-post'
            `;
            const result: EvaluatedData = evaluate(input);
            const expectedEvaluatedVariables: EvaluatedVariable[] = [
                {
                    value: 'MyValue1',
                    range: createRange(3, 34, 3, 42),
                },
                {
                    value: 'MyValue2',
                    range: createRange(3, 43, 3, 51),
                }
            ];
            assert.deepStrictEqual(result.evaluatedVariables, expectedEvaluatedVariables);
        });

        it('should be detected when assigning the value of another variable', () => {
            const input = `
                .MyVar = 'MyValue'
                .Copy = .MyVar
            `;
            const result: EvaluatedData = evaluate(input);
            const expectedEvaluatedVariables: EvaluatedVariable[] = [
                {
                    value: 'MyValue',
                    range: createRange(2, 24, 2, 30),
                }
            ];
            assert.deepStrictEqual(result.evaluatedVariables, expectedEvaluatedVariables);
        });
    });

    describe('variableReferences', () => {
        it('should be detected in a variable definition LHS', () => {
            const input = `
                .MyVar = 1
            `;
            const result: EvaluatedData = evaluate(input);
            const expectedReferences: VariableReference[] = [
                {
                    definition: {
                        range: createRange(1, 16, 1, 22),
                    },
                    range: createRange(1, 16, 1, 22),
                }
            ];
            assert.deepStrictEqual(result.variableReferences, expectedReferences);
        });

        it('should be detected in a variable addition LHS', () => {
            const input = `
                .MyVar = 1
                .MyVar + 2
            `;
            const result: EvaluatedData = evaluate(input);
            const expectedReferences: VariableReference[] = [
                {
                    definition: {
                        range: createRange(1, 16, 1, 22),
                    },
                    range: createRange(1, 16, 1, 22),
                },
                {
                    definition: {
                        range: createRange(1, 16, 1, 22),
                    },
                    range: createRange(2, 16, 2, 22),
                }
            ];
            assert.deepStrictEqual(result.variableReferences, expectedReferences);
        });

        it('should be detected in an evaluated variable (standalone)', () => {
            const input = `
                .MyVar1 = 1
                .MyVar2 = .MyVar1
            `;
            const result: EvaluatedData = evaluate(input);
            const expectedReferences: VariableReference[] = [
                {
                    definition: {
                        range: createRange(1, 16, 1, 23),
                    },
                    range: createRange(1, 16, 1, 23),
                },
                {
                    definition: {
                        range: createRange(1, 16, 1, 23),
                    },
                    range: createRange(2, 26, 2, 33),
                },
                {
                    definition: {
                        range: createRange(2, 16, 2, 23),
                    },
                    range: createRange(2, 16, 2, 23),
                }
            ];
            assert.deepStrictEqual(result.variableReferences, expectedReferences);
        });

        it('should be detected in an evaluated variable (string template)', () => {
            const input = `
                .MyVar1 = 'hello'
                .MyVar2 = '$MyVar1$ world'
            `;
            const result: EvaluatedData = evaluate(input);
            const expectedReferences: VariableReference[] = [
                {
                    definition: {
                        range: createRange(1, 16, 1, 23),
                    },
                    range: createRange(1, 16, 1, 23),
                },
                {
                    definition: {
                        range: createRange(1, 16, 1, 23),
                    },
                    range: createRange(2, 27, 2, 35),
                },
                {
                    definition: {
                        range: createRange(2, 16, 2, 23),
                    },
                    range: createRange(2, 16, 2, 23),
                }
            ];
            assert.deepStrictEqual(result.variableReferences, expectedReferences);
        });
    });
});