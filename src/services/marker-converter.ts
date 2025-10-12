import fs from 'fs';
import path from 'path';
import { parseString } from 'xml2js';
import { promisify } from 'util';

const parseXml = promisify(parseString);

interface Marker {
    time: number;
    label: string;
}

export class MarkerConverter {

    static async convertXmlToLabels(xmlFilePath: string, originalFileName: string): Promise<string> {
        try {
            // Read the XML file
            const xmlContent = fs.readFileSync(xmlFilePath, 'utf8');

            // Parse XML to extract markers
            const markers = await this.parseMarkersFromXml(xmlContent);

            // Convert markers to Audacity label format
            const labelsContent = this.formatAsAudacityLabels(markers);

            // Create output file
            const outputDir = 'outputs';
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
            }

            const baseName = path.basename(originalFileName, path.extname(originalFileName));
            const outputFileName = `${baseName}_markers.txt`;
            const outputFilePath = path.join(outputDir, outputFileName);

            fs.writeFileSync(outputFilePath, labelsContent, 'utf8');

            return outputFilePath;
        } catch (error) {
            throw new Error(`Failed to convert XML to labels: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private static async parseMarkersFromXml(xmlContent: string): Promise<Marker[]> {
        try {
            const result: any = await parseXml(xmlContent);
            const markers: Marker[] = [];

            // Debug: Log the XML structure to understand what we're working with
            console.log('XML parsed result structure:', JSON.stringify(result, null, 2));

            // Try multiple possible XML structures for BWF markers

            // Structure 1: conformance_point_document (from example)
            if (result.conformance_point_document?.conformance_point_list?.[0]?.conformance_point) {
                console.log('Found conformance_point_document structure');
                const conformancePoints = result.conformance_point_document.conformance_point_list[0].conformance_point;

                for (const point of conformancePoints) {
                    if (point.$?.time && point.$?.marker) {
                        const timeInSeconds = this.parseTimeToSeconds(point.$.time);
                        const label = point.$.marker || point.$.name || `Marker ${markers.length + 1}`;

                        markers.push({
                            time: timeInSeconds,
                            label: label
                        });
                    }
                }
            }

            // Structure 2: BWF_data (alternative structure)
            if (markers.length === 0 && result.BWF_data?.markers?.[0]?.marker) {
                console.log('Found BWF_data structure');
                const markerList = result.BWF_data.markers[0].marker;

                for (const marker of markerList) {
                    if (marker.position && marker.position[0]) {
                        const timeInSeconds = this.parseTimeToSeconds(marker.position[0]);
                        const label = marker.name?.[0] || marker.label?.[0] || `Marker ${markers.length + 1}`;

                        markers.push({
                            time: timeInSeconds,
                            label: label
                        });
                    }
                }
            }

            // Structure 3: Direct markers array
            if (markers.length === 0 && result.markers) {
                console.log('Found direct markers structure');
                const markerArray = Array.isArray(result.markers) ? result.markers : [result.markers];

                for (const marker of markerArray) {
                    if (marker.marker) {
                        const markerList = Array.isArray(marker.marker) ? marker.marker : [marker.marker];
                        for (const m of markerList) {
                            if (m.$ && (m.$.position || m.$.time)) {
                                const timeInSeconds = this.parseTimeToSeconds(m.$.position || m.$.time || '0');
                                const label = m.$.name || m.$.label || m.$.marker || `Marker ${markers.length + 1}`;
                                markers.push({
                                    time: timeInSeconds,
                                    label: label
                                });
                            }
                        }
                    }
                }
            }

            // Structure 4: BWFMetaEdit XML output structure with Cues
            if (markers.length === 0 && result.conformance_point_document?.File?.[0]?.Cues?.[0]?.Cue) {
                console.log('Found BWFMetaEdit Cues structure');
                const cues = result.conformance_point_document.File[0].Cues[0];
                const sampleRate = parseFloat(cues.$.samplerate || '44100');
                const cueArray = Array.isArray(cues.Cue) ? cues.Cue : [cues.Cue];

                for (const cue of cueArray) {
                    if (cue.Position && cue.Position[0]) {
                        // Convert sample position to seconds using sample rate
                        const samplePosition = parseFloat(cue.Position[0]);
                        const timeInSeconds = samplePosition / sampleRate;
                        const label = (cue.Label && cue.Label[0]) || `Marker ${markers.length + 1}`;

                        markers.push({
                            time: timeInSeconds,
                            label: label
                        });

                        console.log(`Found cue marker: ${label} at ${timeInSeconds.toFixed(3)}s (sample ${samplePosition})`);
                    }
                }
            }

            // Structure 5: Generic BWFMetaEdit File structure
            if (markers.length === 0 && result.conformance_point_document?.File) {
                console.log('Found BWFMetaEdit File structure');
                const fileData = Array.isArray(result.conformance_point_document.File)
                    ? result.conformance_point_document.File[0]
                    : result.conformance_point_document.File;

                // Look for various marker formats in BWFMetaEdit output
                if (fileData.Core && fileData.Core[0] && fileData.Core[0].bext && fileData.Core[0].bext[0]) {
                    const bext = fileData.Core[0].bext[0];

                    // Check for CuePoints or similar structures
                    if (bext.CuePoint || bext.cue || bext.markers) {
                        const cuePoints = bext.CuePoint || bext.cue || bext.markers;
                        const cueArray = Array.isArray(cuePoints) ? cuePoints : [cuePoints];

                        for (const cue of cueArray) {
                            if (cue.$ && cue.$.position) {
                                const timeInSeconds = this.parseTimeToSeconds(cue.$.position);
                                const label = cue.$.label || cue.$.name || `Marker ${markers.length + 1}`;
                                markers.push({
                                    time: timeInSeconds,
                                    label: label
                                });
                            }
                        }
                    }
                }
            }

            // Structure 6: Generic search for any time/position + label combinations
            if (markers.length === 0) {
                console.log('Trying generic marker search');
                this.searchForMarkersRecursively(result, markers);
            }

            // Sort markers by time
            markers.sort((a, b) => a.time - b.time);

            console.log(`Found ${markers.length} markers:`, markers);
            return markers;
        } catch (error) {
            throw new Error(`XML parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private static searchForMarkersRecursively(obj: any, markers: Marker[], path: string = ''): void {
        if (typeof obj !== 'object' || obj === null) return;

        for (const [key, value] of Object.entries(obj)) {
            const currentPath = path ? `${path}.${key}` : key;

            // Look for objects that might represent markers
            if (typeof value === 'object' && value !== null) {
                // Check if this object has marker-like properties
                if (this.isMarkerLike(value)) {
                    const time = this.extractTime(value);
                    const label = this.extractLabel(value, markers.length);

                    if (time !== null) {
                        console.log(`Found potential marker at ${currentPath}:`, { time, label });
                        markers.push({ time, label });
                    }
                }

                // Recursively search in nested objects/arrays
                if (Array.isArray(value)) {
                    value.forEach((item, index) => {
                        this.searchForMarkersRecursively(item, markers, `${currentPath}[${index}]`);
                    });
                } else {
                    this.searchForMarkersRecursively(value, markers, currentPath);
                }
            }
        }
    }

    private static isMarkerLike(obj: any): boolean {
        if (typeof obj !== 'object' || obj === null) return false;

        // Check for common marker properties
        const timeProps = ['time', 'position', 'offset', 'sample', 'frame'];
        const labelProps = ['name', 'label', 'title', 'text', 'marker', 'comment'];

        const hasTime = timeProps.some(prop =>
            obj.hasOwnProperty(prop) || (obj.$ && obj.$.hasOwnProperty(prop))
        );

        const hasLabel = labelProps.some(prop =>
            obj.hasOwnProperty(prop) || (obj.$ && obj.$.hasOwnProperty(prop))
        );

        return hasTime || hasLabel;
    }

    private static extractTime(obj: any): number | null {
        const timeProps = ['time', 'position', 'offset', 'sample', 'frame'];

        for (const prop of timeProps) {
            let value = obj[prop] || (obj.$ && obj.$[prop]);

            if (value !== undefined) {
                if (Array.isArray(value)) value = value[0];
                if (typeof value === 'string' || typeof value === 'number') {
                    return this.parseTimeToSeconds(value.toString());
                }
            }
        }

        return null;
    }

    private static extractLabel(obj: any, index: number): string {
        const labelProps = ['name', 'label', 'title', 'text', 'marker', 'comment'];

        for (const prop of labelProps) {
            let value = obj[prop] || (obj.$ && obj.$[prop]);

            if (value !== undefined) {
                if (Array.isArray(value)) value = value[0];
                if (typeof value === 'string' && value.trim()) {
                    return value.trim();
                }
            }
        }

        return `Marker ${index + 1}`;
    }

    private static parseTimeToSeconds(timeString: string): number {
        // Handle different time formats
        // Examples: "00:01:23.456", "83.456", "1:23.456"

        if (typeof timeString === 'number') {
            return timeString;
        }

        // If it's a simple number string (seconds)
        if (/^\d+\.?\d*$/.test(timeString)) {
            return parseFloat(timeString);
        }

        // Handle HH:MM:SS.mmm format
        if (timeString.includes(':')) {
            const parts = timeString.split(':');
            let seconds = 0;

            if (parts.length === 3) {
                // HH:MM:SS.mmm
                seconds += parseFloat(parts[0]) * 3600; // hours
                seconds += parseFloat(parts[1]) * 60;   // minutes
                seconds += parseFloat(parts[2]);        // seconds
            } else if (parts.length === 2) {
                // MM:SS.mmm
                seconds += parseFloat(parts[0]) * 60;   // minutes
                seconds += parseFloat(parts[1]);        // seconds
            }

            return seconds;
        }

        // Default: try to parse as float
        return parseFloat(timeString) || 0;
    }

    private static formatAsAudacityLabels(markers: Marker[]): string {
        // Audacity label format: start_time\tend_time\tlabel
        // For point markers, start_time and end_time are the same

        const lines = markers.map(marker => {
            // Format time to 6 decimal places
            const timeString = marker.time.toFixed(6);
            return `${timeString}\t${timeString}\t${marker.label}`;
        });

        return lines.join('\n') + '\n';
    }
}