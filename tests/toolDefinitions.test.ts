import { describe, expect, it } from 'vitest';
import os from 'os';
import { SkillsManager } from '../src/core/SkillsManager';
import { MultiLLM } from '../src/core/MultiLLM';

function makeManager() {
    const config = {
        get: (key: string) => key === 'skillExecutionTimeoutMs' ? 1000 : undefined,
        getDataHome: () => os.tmpdir(),
    };
    const manager = new SkillsManager(undefined as any, undefined, () => ({
        memory: {} as any,
        config: config as any,
        actionQueue: {} as any,
    }));
    manager.setHost({ config: config as any, pushTask: async () => undefined });
    return manager;
}

describe('SkillsManager.parseUsageToSchema', () => {
    it('maps bare params to strings and marks them required', () => {
        const { properties, required } = SkillsManager.parseUsageToSchema('web_search(query, maxResults)');

        expect(properties).toEqual({ query: { type: 'string' }, maxResults: { type: 'string' } });
        expect(required).toEqual(['query', 'maxResults']);
    });

    it('treats a trailing "?" as optional and keeps it out of required', () => {
        const { properties, required } = SkillsManager.parseUsageToSchema('run_command(command, cwd?, timeoutMs?)');

        expect(Object.keys(properties)).toEqual(['command', 'cwd', 'timeoutMs']);
        expect(required).toEqual(['command']);
    });

    it('honours every supported type hint', () => {
        const { properties, required } = SkillsManager.parseUsageToSchema(
            'demo(count:number, n:integer, flag:boolean, tags:array, opts:object)'
        );

        expect(properties.count).toEqual({ type: 'number' });
        expect(properties.n).toEqual({ type: 'integer' });
        expect(properties.flag).toEqual({ type: 'boolean' });
        expect(properties.tags).toEqual({ type: 'array', items: { type: 'string' } });
        expect(properties.opts).toEqual({ type: 'object' });
        expect(required).toEqual(['count', 'n', 'flag', 'tags', 'opts']);
    });

    it('keeps a parameter literally named __proto__ instead of dropping or polluting', () => {
        const { properties } = SkillsManager.parseUsageToSchema('demo(__proto__, constructor)');

        // A null-prototype map means these become own keys rather than touching the prototype.
        expect(Object.getPrototypeOf(properties)).toBeNull();
        expect(Object.prototype.hasOwnProperty.call(properties, '__proto__')).toBe(true);
        expect(properties['__proto__']).toEqual({ type: 'string' });
        expect(properties.constructor).toEqual({ type: 'string' });
        // The global prototype must be untouched.
        expect(({} as any).type).toBeUndefined();
    });

    it('parses the object notation form', () => {
        const { properties, required } = SkillsManager.parseUsageToSchema(
            'create_skill({ name, description, code:number?, tags:array? })'
        );

        expect(properties.name).toEqual({ type: 'string' });
        expect(properties.description).toEqual({ type: 'string' });
        expect(properties.code).toEqual({ type: 'number' });
        expect(properties.tags).toEqual({ type: 'array', items: { type: 'string' } });
        expect(required).toEqual(['name', 'description']);
    });

    it('returns an empty schema when the usage string declares no parameters', () => {
        expect(SkillsManager.parseUsageToSchema('list_directory()')).toEqual({ properties: {}, required: [] });
    });
});

describe('SkillsManager.getToolDefinitions', () => {
    it('emits a closed object schema so invented arguments are rejected by the provider', () => {
        const manager = makeManager();
        manager.registerSkill({
            name: 'web_search',
            description: 'Search the web',
            usage: 'web_search(query, maxResults?)',
            handler: async () => 'ok',
        });

        const [definition] = manager.getToolDefinitions();

        expect(definition.type).toBe('function');
        expect(definition.function.name).toBe('web_search');
        expect(definition.function.parameters).toEqual({
            type: 'object',
            properties: { query: { type: 'string' }, maxResults: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
        });
    });

    it('omits `required` entirely when every parameter is optional', () => {
        const manager = makeManager();
        manager.registerSkill({
            name: 'ping',
            description: 'Ping',
            usage: 'ping(host?)',
            handler: async () => 'ok',
        });

        const [definition] = manager.getToolDefinitions();

        expect(definition.function.parameters).not.toHaveProperty('required');
        expect(definition.function.parameters.additionalProperties).toBe(false);
    });

    it('uses an author-declared schema verbatim in preference to the usage string', () => {
        const manager = makeManager();
        manager.registerSkill({
            name: 'schedule_task',
            description: 'Schedule something',
            usage: 'schedule_task(task, when)',
            parameters: {
                type: 'object',
                properties: {
                    task: { type: 'string', description: 'What to run' },
                    when: { type: 'string', enum: ['hourly', 'daily'] },
                },
                required: ['task', 'when'],
            },
            handler: async () => 'ok',
        });

        const [definition] = manager.getToolDefinitions();
        const parameters: any = definition.function.parameters;

        expect(parameters.properties.task.description).toBe('What to run');
        expect(parameters.properties.when.enum).toEqual(['hourly', 'daily']);
        expect(parameters.required).toEqual(['task', 'when']);
        expect(parameters.additionalProperties).toBe(false);
    });

    it('excludes the requested skills', () => {
        const manager = makeManager();
        manager.registerSkill({ name: 'a', description: 'A', usage: 'a()', handler: async () => 'ok' });
        manager.registerSkill({ name: 'b', description: 'B', usage: 'b()', handler: async () => 'ok' });

        const names = manager.getToolDefinitions(new Set(['a'])).map(d => d.function.name);

        expect(names).toEqual(['b']);
    });
});

describe('MultiLLM.toGeminiSchema', () => {
    it('strips keywords Gemini\'s OpenAPI subset does not accept, recursively', () => {
        const schema = {
            type: 'object',
            additionalProperties: false,
            properties: {
                query: { type: 'string', additionalProperties: false },
                nested: {
                    type: 'object',
                    additionalProperties: false,
                    properties: { deep: { type: 'string' } },
                },
                list: { type: 'array', items: { type: 'string', additionalProperties: false } },
            },
            required: ['query'],
        };

        const sanitized = (MultiLLM as any).toGeminiSchema(schema);
        const serialized = JSON.stringify(sanitized);

        expect(serialized).not.toContain('additionalProperties');
        // Everything Gemini does understand must survive intact.
        expect(sanitized.type).toBe('object');
        expect(sanitized.required).toEqual(['query']);
        expect(sanitized.properties.query).toEqual({ type: 'string' });
        expect(sanitized.properties.nested.properties.deep).toEqual({ type: 'string' });
        expect(sanitized.properties.list.items).toEqual({ type: 'string' });
    });

    it('strips the wider set of non-OpenAPI JSON Schema keywords but keeps supported ones', () => {
        const sanitized = (MultiLLM as any).toGeminiSchema({
            type: 'object',
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            additionalProperties: false,
            oneOf: [{ type: 'string' }],
            allOf: [{ type: 'string' }],
            not: { type: 'string' },
            const: 'x',
            if: { type: 'string' },
            then: { type: 'string' },
            patternProperties: { '^a': { type: 'string' } },
            dependencies: { a: ['b'] },
            multipleOf: 2,
            exclusiveMinimum: 1,
            properties: {
                mode: {
                    type: 'string',
                    enum: ['a', 'b'],
                    default: 'a',
                    format: 'date',
                    nullable: true,
                    minLength: 1,
                    maxLength: 10,
                    oneOf: [{ type: 'string' }],
                },
            },
            anyOf: [{ type: 'object' }],
        });

        for (const dropped of [
            '$schema', 'additionalProperties', 'oneOf', 'allOf', 'not', 'const',
            'if', 'then', 'patternProperties', 'dependencies', 'multipleOf', 'exclusiveMinimum',
        ]) {
            expect(sanitized).not.toHaveProperty(dropped);
        }
        expect(sanitized.properties.mode).not.toHaveProperty('oneOf');

        // Gemini's OpenAPI subset does understand these, so they must survive intact.
        expect(sanitized.properties.mode.enum).toEqual(['a', 'b']);
        expect(sanitized.properties.mode.default).toBe('a');
        expect(sanitized.properties.mode.format).toBe('date');
        expect(sanitized.properties.mode.nullable).toBe(true);
        expect(sanitized.properties.mode.maxLength).toBe(10);
        expect(sanitized.anyOf).toEqual([{ type: 'object' }]);
    });

    it('preserves enum and array item types', () => {
        const sanitized = (MultiLLM as any).toGeminiSchema({
            type: 'object',
            properties: { mode: { type: 'string', enum: ['a', 'b'] } },
        });

        expect(sanitized.properties.mode).toEqual({ type: 'string', enum: ['a', 'b'] });
    });
});
