import express from 'express';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import ejs from 'ejs';
import bodyParser from 'body-parser';
import puppeteer from 'puppeteer';
import axios from 'axios';
import * as cheerio from 'cheerio';
import multer from 'multer';
import * as fs from 'fs';
import path from 'path'; 
import { MongoClient, ObjectId, ServerApiVersion } from "mongodb";  
import { getAllDocuments, getPdfById } from './mongoUtils.js';
import { GoogleGenerativeAI } from "@google/generative-ai";
import cors from 'cors';
import * as chromeLauncher from 'chrome-launcher';


const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(cors());

app.use(express.static('public'));
app.set('view engine', 'ejs');

let url = "";
let title = "";
let description = "";
let keywords = "";

const API_KEY = "AIzaSyCDZbVGTKq7zirbovh5ussOHu3ajyRneLU";
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });


const uri = "mongodb+srv://socialbeat:socialbeat@cluster-website.5knvo.mongodb.net/?retryWrites=true&w=majority&appName=Cluster-website";

const client = new MongoClient(uri, {
    serverApi: {
      version: ServerApiVersion.v1,
      strict: true,
      deprecationErrors: true,
    },
  });
  
  async function pingDatabase() {
    try {
      await client.connect();
      await client.db("admin").command({ ping: 1 });
      console.log(`[${new Date().toLocaleString()}] Ping successful!`);
    } catch (error) {
      console.error("MongoDB ping failed:", error);
    }
  }
  setInterval(pingDatabase, 1800000);
  
  pingDatabase();

  const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
      const originalName = path.basename(file.originalname, path.extname(file.originalname));
      const ext = '.pdf';
      const safeName = originalName.replace(/[^a-zA-Z0-9_.-]/g, '');
  
      let finalName = `${safeName}${ext}`;
      let counter = 1;
  
      while (fs.existsSync(path.join('uploads', finalName))) {
        finalName = `${safeName}-${counter}${ext}`;
        counter++;
      }
  
      cb(null, finalName);
      console.log("File saved as: " + finalName);
    },
  });
  
  const fileFilter = (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'), false);
    }
  };
  
  const upload = multer({ storage, fileFilter });
  
  app.post('/api/pdf-download/internal-storage', upload.single('file'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded or invalid file type." });
    }
    console.log(`PDF saved in the internal storage : ${req.file.filename}`);
    res.status(200).json({ message: "File uploaded successfully", filename: req.file.filename });
  });

  
async function getMetaData(url) {
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);

        return {
            title: $('title').text() || 'No Title Found',
            description: $('meta[name="description"]').attr('content') || 'No Description Found',
            keywords: $('meta[name="keywords"]').attr('content') || 'No Keywords Found',
            author: $('meta[name="author"]').attr('content') || 'No Author Found',
            robots: $('meta[name="robots"]').attr('content') || 'No Robots Found',
            ogTitle: $('meta[property="og:title"]').attr('content') || 'No OG Title Found',
            ogDescription: $('meta[property="og:description"]').attr('content') || 'No OG Description Found',
            ogImage: $('meta[property="og:image"]').attr('content') || 'No OG Image Found',
            ogUrl: $('meta[property="og:url"]').attr('content') || 'No OG URL Found'
        };
    } catch (error) {
        console.error('Error fetching metadata:', error.message);
        throw error;
    }
}

function getSuggestions(metric, value) {
    const suggestions = {
        performance: {
            low: "Focus on optimizing images, minimizing JavaScript, and leveraging browser caching.",
            medium: "Consider implementing lazy loading and optimizing critical rendering path.",
            high: "Great performance! Monitor and maintain current optimizations."
        },
        fcp: {
            low: "Reduce server response time and minimize render-blocking resources.",
            medium: "Optimize CSS delivery and server-side rendering.",
            high: "First Contentful Paint is well optimized."
        },
        si: {
            low: "Improve page load performance and reduce initial server response time.",
            medium: "Consider implementing progressive rendering techniques.",
            high: "Speed Index is performing well."
        },
        tti: {
            low: "Reduce JavaScript execution time and minimize main thread work.",
            medium: "Optimize JavaScript bundles and consider code splitting.",
            high: "Time to Interactive is well optimized."
        }
    };

    if (value < 50) return suggestions[metric].low;
    if (value < 90) return suggestions[metric].medium;
    return suggestions[metric].high;
}

function analyzeImageIssues(imageAudit) {
    const issues = [];
    if (!imageAudit.details || !imageAudit.details.items) return issues;

    imageAudit.details.items.forEach(item => {
        if (item.wastedBytes > 0) {
            issues.push({
                url: item.url,
                wastedBytes: item.wastedBytes,
                totalBytes: item.totalBytes,
                potentialSavings: ((item.wastedBytes / item.totalBytes) * 100).toFixed(1) + '%'
            });
        }
    });

    return issues;
}

async function runLighthouse(url) {
    const chrome = await launch({
        chromeFlags: ['--headless', '--disable-dev-shm-usage']
    });

    const options = {
        logLevel: 'info',
        output: 'json',
        port: chrome.port,
        onlyCategories: ['performance'],
        settings: {
            formFactor: 'desktop',
            throttling: {
                rttMs: 40,
                throughputKbps: 10240,
                cpuSlowdownMultiplier: 1
            }
        }
    };

    try {
        const runnerResult = await lighthouse(url, options);
        await chrome.kill();
        return runnerResult.lhr;
    } catch (error) {
        await chrome.kill();
        throw error;
    }
}

async function checkTextWithEvents(url) {
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        const result = await page.evaluate(() => {
            const elements = document.querySelectorAll('a, div, span');
            let findings = [];
            
            elements.forEach((element) => {
                const text = element.textContent.trim();
                if (text) {
                    const hasOnClick = element.hasAttribute('onclick');
                    const hasHref = element.hasAttribute('href');
                    
                    if (hasOnClick || hasHref) {
                        findings.push({
                            text: text,
                            hasOnClick,
                            hasHref
                        });
                    }
                }
            });
            return findings;
        });

        await browser.close();

        let output = '';
        if (result.length > 0) {
            result.forEach(item => {
                if (item.hasOnClick && item.hasHref) {
                    output += `Text "${item.text}" has both onclick and href attributes.\n`;
                } else if (item.hasOnClick) {
                    output += `Text "${item.text}" has onclick event.\n`;
                } else if (item.hasHref) {
                    output += `Text "${item.text}" has href attribute.\n`;
                }
            });
        } else {
            output = 'No text elements with onclick or href found on the page.';
        }

        return output;
    } catch (error) {
        if (browser) await browser.close();
        throw new Error(`Error checking text: ${error.message}`);
    }
}

async function findMissingAltImages(url) {
    try {
        const { data } = await axios.get(url);
        const $ = cheerio.load(data);
        let missingAltImages = [];

        $('img').each((index, img) => {
            const altText = $(img).attr('alt');
            if (!altText || altText.trim() === '') {
                let attributes = {};
                Object.keys(img.attribs).forEach(attr => {
                    attributes[attr] = img.attribs[attr];
                });
                missingAltImages.push(attributes);
            }
        });

        return missingAltImages;
    } catch (error) {
        console.error('❌ Error fetching the webpage:', error.message);
        return [];
    }
}

async function savePDFToMongoDB(fileName, downloadedAt) {
    const saveclient = new MongoClient(uri);

    try {
        await saveclient.connect();
        console.log("✅ Connected to MongoDB Atlas");

        const database = saveclient.db("document");
        const collection = database.collection("tech-team");

        const document = {
            fileName,
            downloadedAt,
            createdAt: new Date(),
        };

        const result = await collection.insertOne(document);
        console.log(`✅ PDF metadata inserted. ID: ${result.insertedId}`);

        return result.insertedId;
    } catch (err) {
        console.error("❌ Error saving PDF metadata to MongoDB:", err);
        throw err;
    } 
}


app.get('/', (req, res) => {
    res.render('index');
});


app.post("/receive-msg", async (req, res) => {
    try {
        const userInput = req.body.userInput;
        const result = await model.generateContent(JSON.stringify(userInput));
        const responseText = await result.response.text();
        res.json({ success: true, reply: responseText });
    } catch (error) {
        console.error("Error generating response:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

async function competitor_runLighthouse(url) {

    const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless'] });
    const options = { logLevel: 'info', output: 'json', port: chrome.port };
    const runnerResult = await lighthouse(url, options);

    const performanceScore = runnerResult.lhr.categories.performance.score * 100;
    console.log(`🌐 URL: ${url}`);
    console.log(`⚡ Performance Score: ${performanceScore}`);

    await chrome.kill();
    return performanceScore;
}
app.post('/api/checkCompetitorScore', async (req, res) => {
    try {
        const { url } = req.body;

        console.log("Received URL:", url);


        const competitor_runLight_value = await competitor_runLighthouse(url); 

        
        res.json({ score: competitor_runLight_value });

    } catch (error) {
        console.error("Error running Lighthouse:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});
    

app.post('/analyze', async (req, res) => {
    try {
        url = req.body.websiteUrl;
        console.log(`Analyzing website: ${url}`);
        
        const [report, puppeteerResult, metadata] = await Promise.all([
            runLighthouse(url),
            checkTextWithEvents(url),
            getMetaData(url)
        ]);
        
        const performanceScore = report.categories.performance.score * 100;
        const fcpScore = report.audits['first-contentful-paint'].score * 100;
        const siScore = report.audits['speed-index'].score * 100;
        const ttiScore = report.audits['interactive'].score * 100;

        const imageAudits = {
            'modern-image-formats': {
                ...report.audits['modern-image-formats'],
                issues: analyzeImageIssues(report.audits['modern-image-formats']),
                suggestions: [
                    "Convert images to WebP format",
                    "Use AVIF for next-gen optimization",
                    "Implement picture element for fallback support"
                ]
            },
            'uses-responsive-images': {
                ...report.audits['uses-responsive-images'],
                issues: analyzeImageIssues(report.audits['uses-responsive-images']),
                suggestions: [
                    "Implement srcset and sizes attributes",
                    "Serve different image sizes for different devices",
                    "Use responsive images for art direction"
                ]
            }
        };

        const suggestions = {
            performance: getSuggestions('performance', performanceScore),
            fcp: getSuggestions('fcp', fcpScore),
            si: getSuggestions('si', siScore),
            tti: getSuggestions('tti', ttiScore)
        };

        const missingAltImages = await findMissingAltImages(url);

        let aidata = { url, title, description, keywords };
        const prompt = `Based on the website data: ${JSON.stringify(aidata)}, provide a competitor analysis and list 10 real, active competitor website URLs as clean, clickable hyperlinks, ensuring they are valid and publicly accessible without extra characters or formatting. dont prvide the same url which im providing`;
        
        const result = await model.generateContent(prompt);
        const responseText = await result.response.text();

        res.render('result', {
            url,
            metadata,
            performanceScore,
            firstContentfulPaint: report.audits['first-contentful-paint'].displayValue,
            speedIndex: report.audits['speed-index'].displayValue,
            timeToInteractive: report.audits['interactive'].displayValue,
            imageAudits,
            suggestions,
            puppeteerResult,
            missingAltImages,
            responseText,
            metrics: {
                fcp: {
                    score: fcpScore,
                    value: report.audits['first-contentful-paint'].displayValue
                },
                si: {
                    score: siScore,
                    value: report.audits['speed-index'].displayValue
                },
                tti: {
                    score: ttiScore,
                    value: report.audits['interactive'].displayValue
                }
            }
        });
    } catch (error) {
        console.error('Error analyzing website:', error);
        res.render('result', {
            url: req.body.websiteUrl,
            error: 'Failed to analyze the website. Please check the URL and try again.'
        });
    }
});


app.post("/api/pdf-download", async (req, res) => {
    try {
        const { fileName, downloadedAt } = req.body; 

        const insertedId = await savePDFToMongoDB(fileName, downloadedAt);
        res.status(201).json({ success: true, insertedId });
    } catch (error) {
        res.status(500).json({ error: "Internal Server Error" });
    }
});



app.get('/view-data', async (req, res) => {
    try {
        const documents = await getAllDocuments();
        res.render('db', { records: documents });
    } catch (error) {
        res.status(500).send('Error fetching data: ' + error.message);
    }
});



app.get('/view-pdf/:id/:field', async (req, res) => {
    try {
        const document = await getPdfById(req.params.id);
        if (!document || !document[req.params.field]) {
            return res.status(404).send('PDF not found');
        }

        const pdfData = document[req.params.field];
        const filename = document.filename || 'document.pdf';
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
        
        res.send(pdfData.buffer || pdfData);
    } catch (error) {
        res.status(500).send('Error fetching PDF: ' + error.message);
    }
});


const deleteclient = new MongoClient(uri);

app.delete("/delete/:id", async (req, res) => {
    try {
        await deleteclient.connect();
        console.log("✅ Connected to MongoDB Atlas");

        const database = client.db("document");
        const collection = database.collection("tech-team");

        const recordId = req.params.id; 
        console.log("Deleting Record with ID:", recordId);

        const result = await collection.deleteOne({ _id: new ObjectId(recordId) });

        if (result.deletedCount === 1) {
            console.log(`✅ Record with ID ${recordId} deleted successfully.`);
            res.json({ message: `Record with ID ${recordId} deleted.` });
        } else {
            console.log("❌ Record not found.");
            res.status(404).json({ message: "Record not found." });
        }
    } catch (err) {
        console.error("❌ Error deleting record:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});




app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
