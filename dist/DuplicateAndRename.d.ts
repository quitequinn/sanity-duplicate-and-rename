import React from 'react';
import { SanityClient } from 'sanity';
export interface DuplicateAndRenameProps {
    client: SanityClient;
    documentTypes?: string[];
    onComplete?: (results: DuplicationResult) => void;
    onError?: (error: string) => void;
    batchSize?: number;
    dryRun?: boolean;
    maxDocuments?: number;
}
export interface DuplicationResult {
    duplicated: number;
    errors: string[];
    newDocuments: string[];
}
declare const DuplicateAndRename: React.FC<DuplicateAndRenameProps>;
export default DuplicateAndRename;
