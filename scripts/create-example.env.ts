import { ConfigurationSchema } from '../src/configuration';
import fs from 'fs/promises';

/**
 * Recursively unwraps Zod schema definitions to extract type and enum values.
 * @param def - The Zod schema definition object.
 * @returns An object with type and enumValues (if any).
 */
function extractTypeInfo(def: any): { type: string; enumValues?: string[] } {
	if (def.typeName === 'ZodEnum' && def.values) {
		return { type: 'ZodEnum', enumValues: def.values };
	}
	if (def.innerType) {
		return extractTypeInfo(def.innerType._def || def.innerType);
	}
	return { type: def.typeName || 'Unknown type' };
}

const keys: string[] = ConfigurationSchema.keyof().options;

let exampleEnv = '';
for (const key of keys) {
	const def = ConfigurationSchema.shape[key]._def;

	// Default value
	const defaultValue = 'defaultValue' in def ? def.defaultValue() : '';

	// Required
	let isRequired = true;
	let currentDef = def;
	while (currentDef && currentDef.innerType) {
		if (typeof currentDef.innerType.isOptional === 'function' && currentDef.innerType.isOptional()) {
			isRequired = false;
			break;
		}
		currentDef = currentDef.innerType._def || currentDef.innerType;
	}

	// Description
	const description = def.description || '';

	// Type and enum values
	const { type, enumValues } = extractTypeInfo(def);

	const keyType = `${type.replace('Zod', '')}${enumValues ? ` (${enumValues.join(' | ')})` : ''}`;

	exampleEnv += `# ${keyType} ${isRequired ? 'required' : 'optional'} ${description ? `[${description}]` : ''}\n`;
	exampleEnv += `${key}=${defaultValue}\n\n`;
}

fs.writeFile('example.env', exampleEnv, 'utf8');
