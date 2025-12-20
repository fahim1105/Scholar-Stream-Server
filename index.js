// scholar_stream_db
// q1i72QgjY6hBbJHO

const express = require('express')
const cors = require('cors')
const app = express()

require('dotenv').config()
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require('stripe')(process.env.STRIPE_SECRET);

const port = process.env.PORT || 3000


// Firebase admin SDK
const admin = require("firebase-admin");

const serviceAccount = require("./scholarstream-firebase-admin-sdk.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

app.use(express.json());
app.use(cors());

const VerifyFirebaseToken = async (req, res, next) => {
    // console.log('headers in middle ware', req.headers?.authorization)
    const Token = req.headers.authorization;

    if (!Token) {
        return res.status(401).send({ message: 'Unauthorized access' })
    }
    try {
        const tokenId = Token.split(' ')[1];
        const decoded = await admin.auth().verifyIdToken(tokenId);
        console.log('Decoded in the token', decoded);
        req.decoded_email = decoded.email;

        next()
    }
    catch (err) {
        return res.status(401).send({ message: "Unauthorized access" });
    }
}


const uri = `mongodb+srv://${process.env.DB_user}:${process.env.DB_pass}@cluster0.mcccn4v.mongodb.net/?appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();

        const db = client.db('scholar_stream_db');
        const scholarshipsCollection = db.collection('scholarships');
        const reviewsCollection = db.collection('reviews');
        const usersCollection = db.collection('users');
        const paymentCollection = db.collection('payments');

        // middleWare with database access >> admin before allowing admin activity
        // Must be used after VerifyFirebaseToken middleWare
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded_email;
            const query = { email };
            const user = await usersCollection.findOne(query);

            if (!user || user.role !== 'admin') {
                res.send({ message: "Forbidden access" })
            }

            next()
        }

        // API's here

        // User Related API's

        app.post('/users', async (req, res) => {
            const user = req.body;
            const query = { email: user.email };

            const existingUser = await usersCollection.findOne(query);
            if (existingUser) {
                return res.send({ message: "User already exists" });
            }

            user.role = "student";
            user.createdAt = new Date();
            user.status = "active";

            const result = await usersCollection.insertOne(user);
            res.send(result);
        });

        app.get('/users', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const result = await usersCollection.find().toArray();
            res.send(result);
        });

        app.get('/users/:email/role', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            res.send({ role: user?.role || 'student' });
        });

        app.patch('/users/role/:id', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;
            const { role } = req.body;

            const result = await usersCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: { role } }
            );

            res.send(result);
        });

        app.delete('/users/:id', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const id = req.params.id;

            const result = await usersCollection.deleteOne({
                _id: new ObjectId(id)
            });

            res.send(result);
        });

        // Analytics related api
        app.get('/admin/analytics', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const totalUsers = await usersCollection.estimatedDocumentCount();
            const totalScholarships = await scholarshipsCollection.estimatedDocumentCount();

            const payments = await paymentsCollection.aggregate([
                {
                    $group: {
                        _id: null,
                        totalFees: { $sum: "$totalAmount" }
                    }
                }
            ]).toArray();

            res.send({
                totalUsers,
                totalScholarships,
                totalFees: payments[0]?.totalFees || 0
            });
        });

        // GET /admin/application-stats
        app.get('/admin/application-stats', VerifyFirebaseToken, verifyAdmin, async (req, res) => {
            const stats = await applicationsCollection.aggregate([
                {
                    $group: {
                        _id: "$scholarshipCategory",
                        count: { $sum: 1 }
                    }
                },
                {
                    $project: {
                        _id: 0,
                        category: "$_id",
                        applications: "$count"
                    }
                }
            ]).toArray();

            res.send(stats);
        });

        //    Scholarship Related API's

        app.get('/scholarships', async (req, res) => {
            try {
                const { search, category, subject, degree } = req.query;

                const query = {};

                if (search) {
                    query.$or = [
                        { scholarshipName: { $regex: search, $options: 'i' } },
                        { universityName: { $regex: search, $options: 'i' } },
                        { degree: { $regex: search, $options: 'i' } },
                    ];
                }

                if (category) {
                    query.scholarshipCategory = category;
                }
                if (subject) {
                    query.subjectCategory = subject;
                }
                if (degree) {
                    query.degree = degree;
                }

                const cursor = scholarshipsCollection.find(query)
                const result = await cursor.toArray();
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to load scholarships" });
            }
        });

        app.get('/scholarships/top', async (req, res) => {
            try {
                const result = await scholarshipsCollection
                    .find()
                    .sort({ applicationFees: 1 })
                    .limit(6)
                    .toArray();

                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to load scholarships" });
            }
        });

        app.get('/scholarships/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) }
            const result = await scholarshipsCollection.findOne(query);
            res.send(result);
        });

        app.post('/scholarships', async (req, res) => {
            try {
                const scholarship = req.body;
                const result = await scholarshipsCollection.insertOne(scholarship);
                res.send(result);
            } catch (error) {
                res.status(500).send({ message: "Failed to add scholarship" });
            }
        });

        app.delete("/scholarships/:id", async (req, res) => {
            const id = req.params.id;

            const result = await scholarshipsCollection.deleteOne({
                _id: new ObjectId(id),
            });

            res.send(result);
        });

        app.patch("/scholarships/:id", async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;

            const result = await scholarshipsCollection.updateOne(
                { _id: new ObjectId(id) },
                { $set: updatedData }
            );

            res.send(result);
        });


        // Payment Related API's

        app.post('/create-checkout-session', VerifyFirebaseToken, async (req, res) => {
            const { scholarshipId } = req.body;

            const scholarship = await scholarshipsCollection.findOne({
                _id: new ObjectId(scholarshipId)
            });

            if (!scholarship) {
                return res.status(404).send({ message: "Scholarship not found" });
            }

            const amount =
                (scholarship.applicationFees + scholarship.serviceCharge) * 100;

            const session = await stripe.checkout.sessions.create({
                payment_method_types: ['card'],
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            unit_amount: amount,
                            product_data: {
                                name: scholarship.scholarshipName,
                                description: scholarship.universityName
                            }
                        },
                        quantity: 1
                    }
                ],
                customer_email: req.decoded_email,
                mode: 'payment',
                metadata: {
                    scholarshipId: scholarship._id.toString(),
                    scholarshipName: scholarship.scholarshipName
                },
                success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled`
            });

            res.send({ url: session.url });
        });



        // Reviews Related API's

        app.get('/reviews', async (req, res) => {
            try {
                const { scholarshipId } = req.query;

                if (!scholarshipId) {
                    return res.status(400).send({ message: "scholarshipId is required" });
                }
                const query = { scholarship_id: scholarshipId };

                const reviews = await reviewsCollection
                    .find(query)
                    .sort({ createdAt: -1 })
                    .toArray();

                res.send(reviews);
            } catch (error) {
                console.error("Reviews fetch error:", error);
                res.status(500).send({ message: "Failed to fetch reviews" });
            }
        });

        app.post('/reviews', async (req, res) => {
            try {
                const review = req.body;
                review.createdAt = new Date();

                const result = await reviewsCollection.insertOne(review);
                res.send(result);
            } catch (error) {
                console.error(error);
                res.status(500).send({ message: "Failed to add review" });
            }
        });

        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Scholar Stream is streaming now !')
})

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
})
