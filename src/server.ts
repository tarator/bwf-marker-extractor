import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { MarkerConverter } from './services/marker-converter';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = 'uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();

        // Fix UTF-8 encoding issues with filenames
        let filename = file.originalname;
        try {
            // Try to decode if the filename was double-encoded
            if (filename.includes('Ã')) {
                // Convert from latin1 to UTF-8
                filename = Buffer.from(filename, 'latin1').toString('utf8');
            }
        } catch (error) {
            console.log('Filename encoding fix failed, using original:', filename);
        }

        console.log('Original filename:', file.originalname);
        console.log('Fixed filename:', filename);

        cb(null, `${timestamp}-${filename}`);
    }
});

const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'audio/wav' || file.originalname.toLowerCase().endsWith('.wav')) {
            cb(null, true);
        } else {
            cb(new Error('Only WAV files are allowed'));
        }
    },
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE_MB || '100') * 1024 * 1024 // Configurable via env var, default 100MB
    }
});

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.post('/upload', upload.array('wavFiles'), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No WAV files uploaded' });
        }

        const files = req.files as Express.Multer.File[];
        const results = [];

        for (const file of files) {
            // Fix the filename encoding for display
            let correctedFilename = file.originalname;
            try {
                if (correctedFilename.includes('Ã')) {
                    correctedFilename = Buffer.from(correctedFilename, 'latin1').toString('utf8');
                }
            } catch (error) {
                console.log('Filename encoding fix failed for display, using original:', correctedFilename);
            }

            try {
                // Extract BWF metadata using bwfmetaedit
                const xmlFile = await extractBwfMetadata(file.path);

                // Convert XML to Audacity labels (use corrected filename for output naming)
                const labelsFile = await MarkerConverter.convertXmlToLabels(xmlFile, correctedFilename);

                results.push({
                    originalFile: correctedFilename,
                    labelsFile: path.basename(labelsFile),
                    downloadUrl: `/download/${path.basename(labelsFile)}`
                });

                // Clean up temporary XML file
                fs.unlinkSync(xmlFile);

            } catch (error) {
                console.error(`Error processing ${correctedFilename}:`, error);

                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                let userFriendlyMessage = 'Failed to process file';

                // Convert technical errors to user-friendly messages
                switch (errorMessage) {
                    case 'NO_BWF_DATA':
                        userFriendlyMessage = 'This file does not contain BWF markers';
                        break;
                    case 'FILE_NOT_FOUND':
                        userFriendlyMessage = 'File could not be read (possibly due to special characters in filename)';
                        break;
                    case 'PROCESSING_ERROR':
                        userFriendlyMessage = 'Could not process this file format';
                        break;
                    default:
                        if (errorMessage.includes('NO_MARKERS_FOUND')) {
                            userFriendlyMessage = 'This file does not contain any markers';
                        } else if (errorMessage.includes('Failed to convert XML to labels')) {
                            userFriendlyMessage = 'File processed but no markers were found';
                        } else if (errorMessage.includes('XML parsing failed')) {
                            userFriendlyMessage = 'File contains invalid BWF data';
                        }
                        break;
                }

                results.push({
                    originalFile: correctedFilename,
                    error: userFriendlyMessage
                });
            }

            // Clean up uploaded WAV file
            fs.unlinkSync(file.path);
        }

        res.json({ results });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/download/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(__dirname, '../outputs', filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    res.download(filePath, (err) => {
        if (err) {
            console.error('Download error:', err);
            res.status(500).json({ error: 'Download failed' });
        }
    });
});

async function extractBwfMetadata(wavFilePath: string): Promise<string> {
    const outputDir = 'temp';
    const xmlFileName = `${Date.now()}-metadata.xml`;
    const xmlFilePath = path.join(outputDir, xmlFileName);

    // Ensure temp directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    // Debug: Log the actual file path being processed
    console.log('Processing file:', wavFilePath);
    console.log('File exists:', fs.existsSync(wavFilePath));

    try {
        // Use bwfmetaedit to extract metadata as XML
        // Use execFile to avoid shell encoding issues with special characters
        await execFileAsync('bwfmetaedit', [
            `--out-xml=${xmlFilePath}`,
            wavFilePath
        ], {
            encoding: 'utf8',
            env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }
        });

        if (!fs.existsSync(xmlFilePath)) {
            throw new Error('NO_BWF_DATA');
        }

        return xmlFilePath;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        // Check for common error patterns and provide user-friendly messages
        if (errorMessage.includes('File does not exist') || errorMessage.includes('No such file')) {
            throw new Error('FILE_NOT_FOUND');
        }

        if (errorMessage.includes('Command failed') || errorMessage.includes('bwfmetaedit')) {
            throw new Error('NO_BWF_DATA');
        }

        throw new Error('PROCESSING_ERROR');
    }
}

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});