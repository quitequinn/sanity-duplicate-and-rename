import React, { useState, useCallback } from 'react'
import {
  Box,
  Button,
  Card,
  Flex,
  Heading,
  Select,
  Stack,
  Text,
  TextArea,
  TextInput,
  Checkbox,
  Badge,
  Spinner,
  Toast
} from '@sanity/ui'
import { DuplicateIcon, SearchIcon, EditIcon } from '@sanity/icons'
import { SanityClient } from 'sanity'

export interface DuplicateAndRenameProps {
  client: SanityClient
  documentTypes?: string[]
  onComplete?: (results: DuplicationResult) => void
  onError?: (error: string) => void
  batchSize?: number
  dryRun?: boolean
  maxDocuments?: number
}

export interface DuplicationResult {
  duplicated: number
  errors: string[]
  newDocuments: string[]
}

interface DocumentToDuplicate {
  _id: string
  _type: string
  title?: string
  name?: string
  [key: string]: any
}

const DuplicateAndRename: React.FC<DuplicateAndRenameProps> = ({
  client,
  documentTypes = [],
  onComplete,
  onError,
  batchSize = 5, // Lower batch size for duplication to avoid overwhelming
  dryRun = false,
  maxDocuments = 100 // Lower max for duplication
}) => {
  const [selectedType, setSelectedType] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [useCustomQuery, setUseCustomQuery] = useState(false)
  const [customGroqQuery, setCustomGroqQuery] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isScanning, setIsScanning] = useState(false)
  const [documents, setDocuments] = useState<DocumentToDuplicate[]>([])
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [namingPattern, setNamingPattern] = useState('{original} - Copy')
  const [fieldsToUpdate, setFieldsToUpdate] = useState('title,name')
  const [removeReferences, setRemoveReferences] = useState(true)
  const [updateSlugs, setUpdateSlugs] = useState(true)

  const generateNewName = (originalName: string, pattern: string, index?: number): string => {
    let newName = pattern
      .replace('{original}', originalName || 'Document')
      .replace('{index}', index ? index.toString() : '1')
      .replace('{timestamp}', Date.now().toString())
      .replace('{date}', new Date().toISOString().split('T')[0])
    
    return newName
  }

  const scanForDocuments = useCallback(async () => {
    if (!client) return
    
    setIsScanning(true)
    setMessage('Scanning for documents...')
    
    try {
      let query = ''
      
      if (useCustomQuery && customGroqQuery) {
        query = customGroqQuery
      } else {
        const typeFilter = selectedType ? `_type == "${selectedType}"` : 'defined(_type)'
        const searchFilter = searchQuery ? ` && (title match "*${searchQuery}*" || name match "*${searchQuery}*")` : ''
        query = `*[${typeFilter}${searchFilter}][0...${maxDocuments}]`
      }
      
      const docs = await client.fetch(query)
      setDocuments(docs)
      setSelectedDocuments([]) // Reset selection
      setMessage(`Found ${docs.length} documents available for duplication`)
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Scan failed'
      setMessage(`Scan error: ${errorMessage}`)
      onError?.(errorMessage)
    } finally {
      setIsScanning(false)
    }
  }, [client, selectedType, searchQuery, useCustomQuery, customGroqQuery, maxDocuments, onError])

  const cleanDocumentForDuplication = (doc: any): any => {
    const cleaned = { ...doc }
    
    // Remove system fields
    delete cleaned._id
    delete cleaned._rev
    delete cleaned._createdAt
    delete cleaned._updatedAt
    
    // Remove references if specified
    if (removeReferences) {
      const removeRefs = (obj: any): any => {
        if (Array.isArray(obj)) {
          return obj.map(removeRefs)
        } else if (obj && typeof obj === 'object') {
          if (obj._type === 'reference') {
            return null // Remove reference
          }
          const newObj: any = {}
          Object.keys(obj).forEach(key => {
            const result = removeRefs(obj[key])
            if (result !== null) {
              newObj[key] = result
            }
          })
          return newObj
        }
        return obj
      }
      
      Object.keys(cleaned).forEach(key => {
        cleaned[key] = removeRefs(cleaned[key])
      })
    }
    
    // Update slugs if specified
    if (updateSlugs && cleaned.slug?.current) {
      cleaned.slug = {
        _type: 'slug',
        current: `${cleaned.slug.current}-copy-${Date.now()}`
      }
    }
    
    return cleaned
  }

  const duplicateDocuments = useCallback(async () => {
    if (!client || selectedDocuments.length === 0) return
    
    setIsLoading(true)
    setMessage('Duplicating documents...')
    
    try {
      let duplicated = 0
      const errors: string[] = []
      const newDocuments: string[] = []
      
      const docsToProcess = documents.filter(doc => selectedDocuments.includes(doc._id))
      
      for (let i = 0; i < docsToProcess.length; i += batchSize) {
        const batch = docsToProcess.slice(i, i + batchSize)
        
        for (const doc of batch) {
          try {
            // Clean the document for duplication
            const cleanedDoc = cleanDocumentForDuplication(doc)
            
            // Update specified fields with new names
            const fieldsToUpdateArray = fieldsToUpdate.split(',').map(f => f.trim())
            fieldsToUpdateArray.forEach(field => {
              if (cleanedDoc[field]) {
                cleanedDoc[field] = generateNewName(cleanedDoc[field], namingPattern, duplicated + 1)
              }
            })
            
            if (!dryRun) {
              const result = await client.create(cleanedDoc)
              newDocuments.push(result._id)
            } else {
              // In dry run, generate a fake ID for preview
              newDocuments.push(`preview-${doc._id}-copy`)
            }
            
            duplicated++
            
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Duplication failed'
            errors.push(`Failed to duplicate ${doc._id}: ${errorMessage}`)
          }
        }
        
        setMessage(`${dryRun ? 'Would duplicate' : 'Duplicated'} ${duplicated}/${selectedDocuments.length} documents...`)
      }
      
      const result: DuplicationResult = {
        duplicated,
        errors,
        newDocuments
      }
      
      setMessage(`${dryRun ? 'Dry run complete' : 'Duplication complete'}: ${duplicated} documents processed`)
      onComplete?.(result)
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Duplication failed'
      setMessage(`Duplication error: ${errorMessage}`)
      onError?.(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }, [client, documents, selectedDocuments, batchSize, dryRun, namingPattern, fieldsToUpdate, removeReferences, updateSlugs, generateNewName, cleanDocumentForDuplication, onComplete, onError])

  const toggleDocumentSelection = (docId: string) => {
    setSelectedDocuments(prev => 
      prev.includes(docId) 
        ? prev.filter(id => id !== docId)
        : [...prev, docId]
    )
  }

  const selectAllDocuments = () => {
    setSelectedDocuments(documents.map(doc => doc._id))
  }

  const clearSelection = () => {
    setSelectedDocuments([])
  }

  return (
    <Card padding={4}>
      <Stack space={4}>
        <Heading size={2}>Duplicate and Rename</Heading>
        
        <Text size={1} muted>
          Duplicate documents with customizable naming patterns and field updates.
        </Text>

        {/* Document Type Selection */}
        <Stack space={2}>
          <Text weight="semibold">Document Type</Text>
          <Select
            value={selectedType}
            onChange={(event) => setSelectedType(event.currentTarget.value)}
          >
            <option value="">All document types</option>
            {documentTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </Select>
        </Stack>

        {/* Duplication Configuration */}
        <Card padding={3} tone="primary">
          <Stack space={3}>
            <Text weight="semibold">Duplication Configuration</Text>
            
            <Stack space={2}>
              <Text size={1} weight="medium">Naming Pattern</Text>
              <TextInput
                placeholder="Use {original}, {index}, {timestamp}, {date}"
                value={namingPattern}
                onChange={(event) => setNamingPattern(event.currentTarget.value)}
              />
              <Text size={1} muted>
                Available placeholders: {'{original}'} (original name), {'{index}'} (copy number), {'{timestamp}'} (current timestamp), {'{date}'} (current date)
              </Text>
            </Stack>
            
            <Stack space={2}>
              <Text size={1} weight="medium">Fields to Update</Text>
              <TextInput
                placeholder="Comma-separated field names (e.g., title,name,heading)"
                value={fieldsToUpdate}
                onChange={(event) => setFieldsToUpdate(event.currentTarget.value)}
              />
              <Text size={1} muted>
                These fields will be updated with the new naming pattern
              </Text>
            </Stack>
            
            <Flex gap={3}>
              <Checkbox
                checked={removeReferences}
                onChange={(event) => setRemoveReferences(event.currentTarget.checked)}
              >
                Remove references
              </Checkbox>
              
              <Checkbox
                checked={updateSlugs}
                onChange={(event) => setUpdateSlugs(event.currentTarget.checked)}
              >
                Update slugs
              </Checkbox>
            </Flex>
          </Stack>
        </Card>

        {/* Search Configuration */}
        <Stack space={3}>
          <Text weight="semibold">Search Configuration</Text>
          
          <Checkbox
            checked={useCustomQuery}
            onChange={(event) => setUseCustomQuery(event.currentTarget.checked)}
          >
            Use custom GROQ query
          </Checkbox>
          
          {useCustomQuery ? (
            <TextArea
              placeholder="Enter GROQ query (e.g., *[_type == 'post' && defined(title)])..."
              value={customGroqQuery}
              onChange={(event) => setCustomGroqQuery(event.currentTarget.value)}
              rows={3}
            />
          ) : (
            <TextInput
              placeholder="Search in title, name, or other fields..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              onKeyPress={(event) => event.key === 'Enter' && scanForDocuments()}
            />
          )}
          
          <Button
            text="Scan for Documents"
            onClick={scanForDocuments}
            disabled={isScanning || isLoading}
            tone="primary"
            icon={SearchIcon}
          />
        </Stack>

        {/* Document Selection */}
        {documents.length > 0 && (
          <Card padding={3} tone="transparent">
            <Stack space={3}>
              <Flex align="center" justify="space-between">
                <Flex align="center" gap={2}>
                  <Text weight="semibold">Available Documents</Text>
                  <Badge tone="primary">{documents.length} found</Badge>
                  <Badge tone="positive">{selectedDocuments.length} selected</Badge>
                </Flex>
                
                <Flex gap={2}>
                  <Button
                    text="Select All"
                    mode="ghost"
                    onClick={selectAllDocuments}
                    disabled={selectedDocuments.length === documents.length}
                  />
                  <Button
                    text="Clear"
                    mode="ghost"
                    onClick={clearSelection}
                    disabled={selectedDocuments.length === 0}
                  />
                </Flex>
              </Flex>
              
              <Box style={{ maxHeight: '300px', overflow: 'auto' }}>
                <Stack space={2}>
                  {documents.map((doc) => {
                    const isSelected = selectedDocuments.includes(doc._id)
                    const previewName = generateNewName(
                      doc.title || doc.name || 'Document',
                      namingPattern,
                      selectedDocuments.indexOf(doc._id) + 1
                    )
                    
                    return (
                      <Card 
                        key={doc._id} 
                        padding={2} 
                        tone={isSelected ? 'primary' : 'default'}
                        style={{ cursor: 'pointer' }}
                        onClick={() => toggleDocumentSelection(doc._id)}
                      >
                        <Stack space={1}>
                          <Flex justify="space-between" align="center">
                            <Text size={1}>
                              <strong>{doc._type}</strong>: {doc.title || doc.name || doc._id}
                            </Text>
                            <Checkbox checked={isSelected} readOnly />
                          </Flex>
                          {isSelected && (
                            <Text size={1} muted>
                              Will be duplicated as: <strong>{previewName}</strong>
                            </Text>
                          )}
                        </Stack>
                      </Card>
                    )
                  })}
                </Stack>
              </Box>
              
              <Button
                text={dryRun ? 'Preview Duplication' : 'Duplicate Selected'}
                onClick={duplicateDocuments}
                disabled={isLoading || isScanning || selectedDocuments.length === 0}
                tone="positive"
                icon={DuplicateIcon}
              />
            </Stack>
          </Card>
        )}

        {/* Status */}
        {(isLoading || isScanning || message) && (
          <Card padding={3} tone={isLoading || isScanning ? 'primary' : 'positive'}>
            <Flex align="center" gap={2}>
              {(isLoading || isScanning) && <Spinner />}
              <Text>{message}</Text>
            </Flex>
          </Card>
        )}

        {/* Settings */}
        <Card padding={3} tone="transparent">
          <Stack space={2}>
            <Text weight="semibold" size={1}>Settings</Text>
            <Flex gap={3} align="center">
              <Checkbox checked={dryRun} readOnly>
                Dry run mode: {dryRun ? 'ON' : 'OFF'}
              </Checkbox>
              <Text size={1} muted>Batch size: {batchSize}</Text>
              <Text size={1} muted>Max documents: {maxDocuments}</Text>
            </Flex>
          </Stack>
        </Card>

        {/* Info */}
        <Card padding={3} tone="transparent">
          <Stack space={2}>
            <Text weight="semibold" size={1}>Duplication Process</Text>
            <Text size={1} muted>
              • System fields (_id, _rev, timestamps) are automatically removed
            </Text>
            <Text size={1} muted>
              • References can be optionally removed to avoid conflicts
            </Text>
            <Text size={1} muted>
              • Slugs are automatically updated to prevent duplicates
            </Text>
            <Text size={1} muted>
              • Specified fields are updated with the naming pattern
            </Text>
          </Stack>
        </Card>
      </Stack>
    </Card>
  )
}

export default DuplicateAndRename