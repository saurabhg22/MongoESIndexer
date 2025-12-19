/**
 * Checks if an array contains only the specified fields
 * @param fields - Array of strings to check
 * @returns boolean indicating if the array contains only the specified fields
 */
export const hasOnlyIndexingFields = (fields: string[], excludeFields: string[] = []): boolean => {
	const validFields = ['lastESIndexedAt', 'lastESIndexResponse', ...excludeFields] as const;
	if (!fields.length) return true;
	return (
		fields.length <= validFields.length &&
		fields.every((field) => validFields.includes(field as (typeof validFields)[number]))
	);
};
