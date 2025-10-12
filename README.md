# BWF Marker Extractor

A web application for extracting BWF (Broadcast Wave Format) markers from WAV files which are written for example by Zoom H5 Handy Recorder and converting them to Audacity-compatible label files which can be imported using "File → Import → Labels" in Audacity.

## Features

- Upload multiple WAV files with embedded BWF marker data
- Extract markers using the `bwfmetaedit` command-line tool
- Convert XML marker data to Audacity label format
- Download processed label files for import into Audacity
- Modern web interface with drag-and-drop support
- Docker containerization for easy deployment

## Requirements

- Node.js 18+ (for local development)
- Docker and Docker Compose (for containerized deployment)
- `bwfmetaedit` tool (compiled from source in Docker image)

## Installation & Usage

### Using Docker (Recommended)

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd bwf-marker-extractor
   ```

2. Build and run with Docker Compose:
   ```bash
   docker-compose up --build
   ```

3. Open your browser and navigate to `http://localhost:3000`

### Local Development

1. Install dependencies:
   ```bash
   npm install
   ```

2. Install `bwfmetaedit` on your system:
   - **Ubuntu/Debian**: Compile from source (see [BWFMetaEdit GitHub](https://github.com/MediaArea/BWFMetaEdit))
     ```bash
     sudo apt-get install git automake autoconf libtool pkg-config make g++ zlib1g-dev
     git clone https://github.com/MediaArea/BWFMetaEdit.git
     cd BWFMetaEdit/Project/GNU/CLI
     ./autogen.sh && ./configure && make && sudo make install
     ```
   - **macOS**: `brew install bwfmetaedit`  
   - **Windows**: Download from [MediaArea website](https://mediaarea.net/BWFMetaEdit)

3. Build the project:
   ```bash
   npm run build
   ```

4. Start the server:
   ```bash
   npm start
   ```
   
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

5. Open your browser and navigate to `http://localhost:3000`

## How It Works

1. **Upload**: Users can upload one or more WAV files containing BWF marker data
2. **Extract**: The server uses `bwfmetaedit` to extract metadata as XML
3. **Convert**: The XML is parsed and converted to Audacity label format
4. **Download**: Users can download the generated label files

## API Endpoints

- `GET /` - Main web interface
- `POST /upload` - Upload WAV files for processing
- `GET /download/:filename` - Download processed label files

## File Formats

### Input
- WAV files with embedded BWF marker data

### Output
- Text files in Audacity label format:
  ```
  start_time	end_time	label
  0.000000	0.000000	Marker 1
  30.500000	30.500000	Marker 2
  ```

## Configuration

Environment variables:
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)

## Development

### Project Structure
```
├── src/
│   ├── server.ts              # Main server file
│   └── services/
│       └── marker-converter.ts # XML to label conversion logic
├── public/
│   └── index.html             # Frontend interface
├── Dockerfile                 # Docker configuration
├── docker-compose.yml         # Docker Compose setup
└── package.json               # Node.js dependencies
```

### Building
```bash
npm run build    # Compile TypeScript
npm run watch    # Watch mode for development
```

### Testing
Upload test WAV files with BWF markers and verify:
1. Files are processed without errors
2. Label files are generated correctly
3. Labels can be imported into Audacity

## Troubleshooting

### Common Issues

1. **"bwfmetaedit not found"**
   - Ensure `bwfmetaedit` is installed and in PATH
   - Use Docker image which includes the tool

2. **"No markers found"**
   - Verify WAV file contains BWF marker data
   - Check XML output for correct structure

3. **Upload fails**
   - Ensure files are valid WAV format
   - Check file size limits

### Logs
Check server logs for detailed error information:
```bash
docker-compose logs -f bwf-marker-extractor
```

## License

MIT License - see LICENSE file for details

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request