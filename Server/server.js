// server.js
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer'); 
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
const app = express();
const port = process.env.PORT || 3000;
const jwtSecret = process.env.JWT_SECRET || 'rahasiawkwk';

// Middleware
app.use(bodyParser.json());
app.use(cors());

// Konfigurasi Multer
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// MongoDB URI
const uri = process.env.MONGODB_URI || "mongodb+srv://kelompok3admin:DHXEi0yKSGE9Wq3p@pppl.nn2fu.mongodb.net/retryWrites=true&w=majority";
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

// Pastikan Anda memeriksa apakah variabel lingkungan ini ada
if (!process.env.JWT_SECRET || !process.env.MONGODB_URI) {
  console.warn("Warning: Using default values for JWT_SECRET or MONGODB_URI. Make sure to set these in production.");
}

function authenticateUser(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).send('Access denied. No token provided.');
    }

    try {
        const decoded = jwt.verify(token, jwtSecret);
        console.log('Decoded Token:', decoded); // Tambahkan log untuk debug
        req.user = decoded;
        next();
    } catch (ex) {
        res.status(400).send('Invalid token.');
    }
}


module.exports = authenticateUser;


// Middleware to verify JWT
function verifyToken(req, res, next) {
    const token = req.header('Authorization')?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Access denied' });

    try {
        const decoded = jwt.verify(token, jwtSecret);
        req.userId = decoded.userId;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid token' });
    }
}

async function main() {
    try {
        await client.connect();
        console.log("Connected to MongoDB");

        const database = client.db('userDB');
        const users = database.collection('users');
        const bucket = new GridFSBucket(database, { bucketName: 'images' });
        const projects = database.collection('progress');

        // Register Route
        app.post('/register', async (req, res) => {
            const { firstName, lastName, email, password } = req.body;
        
            try {
                const hashedPassword = await bcrypt.hash(password, 10);
                const newUser = { firstName, lastName, email, password: hashedPassword, role: 'user' };
        
                const result = await users.insertOne(newUser);
        
                if (result.acknowledged) {
                    res.status(201).send('User registered successfully');
                } else {
                    res.status(500).send('Failed to register user');
                }
            } catch (error) {
                console.error('Error inserting user:', error);
                res.status(500).send('Registration failed');
            }
        });

        // Login Route
        app.post('/login', async (req, res) => {
            const { email, password } = req.body;
        
            try {
                const user = await users.findOne({ email });
                if (!user) {
                    return res.status(401).send('Invalid email or password');
                }
        
                const isPasswordValid = await bcrypt.compare(password, user.password);
                if (!isPasswordValid) {
                    return res.status(401).send('Invalid email or password');
                }
        
                // Generate token
                const token = jwt.sign({ userId: user._id, role: user.role }, jwtSecret, { expiresIn: '1h' });
        
                // Send token to client
                res.status(200).json({ token, role: user.role });
            } catch (error) {
                console.error('Error during login:', error);
                res.status(500).send('Login failed');
            }
        });

        // Example of a protected route
        app.get('/protected', verifyToken, (req, res) => {
            res.status(200).json({ message: 'Protected route accessed' });
        });

        // Endpoint to get list of users
        app.get('/admin/users', verifyToken, async (req, res) => {
            try {
                const userList = await users.find({ role: 'user' }, { projection: { email: 1 } }).toArray();
                res.json(userList);
            } catch (error) {
                console.error('Error retrieving users:', error);
                res.status(500).send('Failed to retrieve users');
            }
        });
        
        app.get('/admin/projects/:userId', verifyToken, async (req, res) => {
            const { userId } = req.params;
            try {
                const projectList = await projects.find({ userId }).toArray();
                res.json(projectList);
            } catch (error) {
                console.error('Error retrieving projects:', error);
                res.status(500).send('Failed to retrieve projects');
            }
        });

        // Upload Route
        app.post('/admin/upload', verifyToken, upload.single('image'), async (req, res) => {
            const { userId, description } = req.body;
            const file = req.file;
        
            if (!file) {
                return res.status(400).send('No file uploaded.');
            }
        
            try {
                const uploadStream = bucket.openUploadStream(file.originalname, {
                    contentType: file.mimetype
                });
        
                uploadStream.end(file.buffer, async (err) => {
                    if (err) {
                        return res.status(500).send('Error uploading file.');
                    }
        
                    const imageId = uploadStream.id;
                    await projects.insertOne({ userId, description, imageId });
                    res.status(201).send('File uploaded successfully.');
                });
            } catch (error) {
                console.error('Error during upload process:', error);
                res.status(500).send('An error occurred during upload.');
            }
        });

        // Retrieve Images and Descriptions
        app.get('/projects', verifyToken, async (req, res) => {
            try {
                const projectList = await projects.find().toArray();
                res.json(projectList);
            } catch (error) {
                console.error('Error retrieving projects:', error);
                res.status(500).send('Failed to retrieve projects');
            }
        });

        app.get('/user/projects', authenticateUser, async (req, res) => {
            try {
                // Log user ID untuk debugging
                console.log('User ID:', req.user.userId);
        
                // Ambil data proyek dari MongoDB berdasarkan userId
                const projectsList = await projects.find({ userId: req.user.userId }).toArray();
        
                // Log hasil query untuk debugging
                console.log('Projects retrieved:', projectsList);
        
                // Kirimkan data proyek ke client
                res.json(projectsList);
            } catch (error) {
                // Log error jika terjadi kesalahan
                console.error('Error retrieving projects:', error);
        
                // Kirimkan respon error ke client
                res.status(500).json({ error: 'Failed to load projects' });
            }
        });
                
                // Update Project with Image
        app.put('/admin/projects/:projectId', authenticateUser, upload.single('image'), async (req, res) => {
            const { projectId } = req.params;
            const { description } = req.body;
            const file = req.file;

            try {
                const updateFields = { description };

                if (file) {
                    // Handle image upload
                    const uploadStream = bucket.openUploadStream(file.originalname);
                    uploadStream.end(file.buffer);

                    uploadStream.on('finish', async () => {
                        updateFields.imageId = uploadStream.id;

                        const result = await projects.updateOne(
                            { _id: new ObjectId(projectId) },
                            { $set: updateFields }
                        );

                        if (result.modifiedCount > 0) {
                            res.status(200).send('Project updated successfully');
                        } else {
                            res.status(404).send('Project not found');
                        }
                    });
                } else {
                    const result = await projects.updateOne(
                        { _id: new ObjectId(projectId) },
                        { $set: updateFields }
                    );

                    if (result.modifiedCount > 0) {
                        res.status(200).send('Project updated successfully');
                    } else {
                        res.status(404).send('Project not found');
                    }
                }
            } catch (error) {
                console.error('Error updating project:', error);
                res.status(500).send('Failed to update project');
            }
        });

        // Delete Project
        app.delete('/admin/projects/:projectId', authenticateUser, async (req, res) => {
            const { projectId } = req.params;

            try {
                const result = await projects.deleteOne({ _id: new ObjectId(projectId) });

                if (result.deletedCount > 0) {
                    res.status(200).send('Project deleted successfully');
                } else {
                    res.status(404).send('Project not found');
                }
            } catch (error) {
                console.error('Error deleting project:', error);
                res.status(500).send('Failed to delete project');
            }
        });
        

        // Serve images from GridFS
        app.get('/images/:id', async (req, res) => {
            const { id } = req.params;
            try {
                const downloadStream = bucket.openDownloadStream(new ObjectId(id));

                downloadStream.on('data', (chunk) => {
                    res.write(chunk);
                });

                downloadStream.on('error', () => {
                    res.sendStatus(404);
                });

                downloadStream.on('end', () => {
                    res.end();
                });
            } catch (error) {
                console.error('Error serving image:', error);
                res.status(500).send('Failed to serve image');
            }
        });

        app.listen(port, () => {
            console.log(`Server running at http://localhost:${port}`);
        });

    } catch (err) {
        console.error('Connection error:', err);
    }
}

async function addAdminUser() {
    const users = client.db('userDB').collection('users');
    const adminEmail = 'admin@admin.com';
    const adminPassword = 'admin123';

    // Check if admin user already exists
    const existingAdmin = await users.findOne({ email: adminEmail });
    if (existingAdmin) {
        console.log('Admin user already exists.');
        return;
    }

    // Hash the admin password
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    // Create admin user
    const adminUser = {
        firstName: 'Admin',
        lastName: 'User',
        email: adminEmail,
        password: hashedPassword,
        role: 'admin'
    };

    // Insert admin user into the database
    await users.insertOne(adminUser);
    console.log('Admin user created successfully.');
}

// Call the function to add admin user
addAdminUser().catch(console.error);
main().catch(console.error);
