import express from 'express';
import multer from 'multer';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { MarkerConverter } from './services/marker-converter';

const execAsync = promisify(exec);
const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
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
        cb(null, `${timestamp}-${file.originalname}`);
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
            try {
                // Extract BWF metadata using bwfmetaedit
                const xmlFile = await extractBwfMetadata(file.path);

                // Convert XML to Audacity labels
                const labelsFile = await MarkerConverter.convertXmlToLabels(xmlFile, file.originalname);

                results.push({
                    originalFile: file.originalname,
                    labelsFile: path.basename(labelsFile),
                    downloadUrl: `/download/${path.basename(labelsFile)}`
                });

                // Clean up temporary XML file
                fs.unlinkSync(xmlFile);

            } catch (error) {
                console.error(`Error processing ${file.originalname}:`, error);
                results.push({
                    originalFile: file.originalname,
                    error: `Failed to process file: ${error instanceof Error ? error.message : 'Unknown error'}`
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

    try {
        // Use bwfmetaedit to extract metadata as XML
        const command = `bwfmetaedit --out-xml="${xmlFilePath}" "${wavFilePath}"`;
        await execAsync(command);

        if (!fs.existsSync(xmlFilePath)) {
            throw new Error('BWF metadata extraction failed - no XML output generated');
        }

        return xmlFilePath;
    } catch (error) {
        throw new Error(`BWF extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});